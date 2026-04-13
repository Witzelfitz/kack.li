export function createSuggestionsService({
  episodes,
  suggestions,
  tryJson,
  mergeStringArrays,
  normalizeText,
  normalizeGuestEntry,
  normalizeTopicEntry,
  normalizeFilmTitle,
  getWorkIdFromFilmTitle,
  getEffectiveFilmTitle,
  log,
  saveDb,
}) {
  function normalizeSuggestionRow(row) {
    return {
      id: row.id,
      episode_id: row.episode_id,
      episode_title: row.episode_title,
      type: row.suggestion_type,
      value: row.value,
      note: row.note || null,
      status: row.status,
      created_at: row.created_at,
      reviewed_at: row.reviewed_at || null,
      review_note: row.review_note || null,
      reviewed_by: row.reviewed_by || null,
      review_source: row.review_source || null,
    };
  }

  function getEpisodeSuggestionFlow(episodeId, limit = 200) {
    const rows = suggestions.listForEpisode(episodeId, { limit });
    const flow = { pending: 0, approved: 0, rejected: 0, total: rows.length };

    for (const row of rows) {
      if (row.status === 'approved') flow.approved += 1;
      else if (row.status === 'rejected') flow.rejected += 1;
      else flow.pending += 1;
    }

    return {
      flow,
      suggestions: rows.map(normalizeSuggestionRow),
    };
  }

  function getEpisodeSuggestionHistory(episodeId, limit = 400) {
    const rows = suggestions.listForEpisode(episodeId, { limit });
    const events = [];

    for (const row of rows) {
      const normalized = normalizeSuggestionRow(row);
      events.push({
        timestamp: normalized.created_at,
        event: 'created',
        suggestion_id: normalized.id,
        type: normalized.type,
        value: normalized.value,
        note: normalized.note,
      });

      if (normalized.reviewed_at) {
        events.push({
          timestamp: normalized.reviewed_at,
          event: normalized.status,
          suggestion_id: normalized.id,
          type: normalized.type,
          value: normalized.value,
          review_note: normalized.review_note,
          reviewed_by: normalized.reviewed_by,
          review_source: normalized.review_source,
        });
      }
    }

    events.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
    return events;
  }

  function getPendingQueue(limit = 20) {
    return suggestions.listPending(limit).map(normalizeSuggestionRow);
  }

  function hasGuestCluster(ep, value) {
    const target = normalizeGuestEntry(value);
    if (!target) return false;

    const mergedGuests = mergeStringArrays(tryJson(ep?.guests_json), tryJson(ep?.manual_guests_json));
    return mergedGuests.some((guest) => normalizeGuestEntry(guest)?.id === target.id);
  }

  function hasTopicCluster(ep, value) {
    const target = normalizeTopicEntry(value);
    if (!target) return false;

    const mergedTopics = mergeStringArrays(tryJson(ep?.topics_json), tryJson(ep?.manual_topics_json));
    return mergedTopics.some((topic) => normalizeTopicEntry(topic)?.id === target.id);
  }

  function resolveCanonicalFilmTitle(value) {
    const normalized = normalizeFilmTitle(value);
    if (!normalized) return null;

    const workId = getWorkIdFromFilmTitle(normalized);
    if (!workId) return normalized;

    const rows = episodes.worksRows?.() || [];
    const counts = new Map();

    for (const row of rows) {
      const candidate = normalizeFilmTitle(getEffectiveFilmTitle(row));
      if (!candidate) continue;
      if (getWorkIdFromFilmTitle(candidate) !== workId) continue;
      counts.set(candidate, (counts.get(candidate) || 0) + 1);
    }

    if (!counts.size) return normalized;

    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'de'))[0][0];
  }

  function reviewSuggestion({ suggestionId, action, reviewNote = '', reviewedBy = 'unknown', reviewSource = 'admin-api' }) {
    const suggestion = suggestions.getById(suggestionId);
    if (!suggestion) {
      return { ok: false, status: 404, error: 'Suggestion nicht gefunden.' };
    }
    if (suggestion.status !== 'pending') {
      return { ok: false, status: 409, error: 'Diese Suggestion wurde bereits bearbeitet.' };
    }

    if (action === 'approve') {
      const ep = episodes.getById(suggestion.episode_id);
      if (!ep) return { ok: false, status: 404, error: 'Episode nicht gefunden.' };

      if (suggestion.suggestion_type === 'film') {
        const canonicalFilm = resolveCanonicalFilmTitle(suggestion.value);
        if (canonicalFilm) {
          episodes.updateManualFilmTitle(suggestion.episode_id, canonicalFilm);
        }
      } else if (suggestion.suggestion_type === 'guest') {
        const canonicalGuest = normalizeGuestEntry(suggestion.value)?.name || suggestion.value;
        if (!hasGuestCluster(ep, canonicalGuest)) {
          const merged = mergeStringArrays(tryJson(ep.manual_guests_json), [canonicalGuest]);
          episodes.updateManualArray('manual_guests_json', suggestion.episode_id, merged);
        }
      } else {
        const canonicalTopic = normalizeTopicEntry(suggestion.value)?.name || suggestion.value;
        if (!hasTopicCluster(ep, canonicalTopic)) {
          const merged = mergeStringArrays(tryJson(ep.manual_topics_json), [canonicalTopic]);
          episodes.updateManualArray('manual_topics_json', suggestion.episode_id, merged);
        }
      }
    }

    const reviewedAt = new Date().toISOString();
    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    suggestions.markReviewed(
      suggestionId,
      newStatus,
      reviewedAt,
      reviewNote || null,
      normalizeText(reviewedBy) || 'unknown',
      normalizeText(reviewSource) || 'admin-api'
    );

    log('suggestion-review', `Suggestion #${suggestionId} ${action === 'approve' ? 'freigegeben' : 'abgelehnt'}`, {
      suggestion_id: suggestionId,
      episode_id: suggestion.episode_id,
      type: suggestion.suggestion_type,
      value: suggestion.value,
      reviewed_by: reviewedBy,
      review_source: reviewSource,
    });

    saveDb();

    return {
      ok: true,
      id: suggestionId,
      status: newStatus,
      episode_id: suggestion.episode_id,
      type: suggestion.suggestion_type,
      value: suggestion.value,
      reviewed_at: reviewedAt,
      reviewed_by: normalizeText(reviewedBy) || 'unknown',
      review_source: normalizeText(reviewSource) || 'admin-api',
      review_note: reviewNote || null,
    };
  }

  function isSuggestionAlreadyMerged(ep, suggestionType, value) {
    if (suggestionType === 'film') {
      const current = getWorkIdFromFilmTitle(getEffectiveFilmTitle(ep));
      const proposed = getWorkIdFromFilmTitle(value);
      if (current && proposed) return current === proposed;
      return normalizeText(getEffectiveFilmTitle(ep)).toLowerCase() === normalizeText(value).toLowerCase();
    }
    if (suggestionType === 'guest') {
      return hasGuestCluster(ep, value);
    }

    return hasTopicCluster(ep, value);
  }

  return {
    getPendingQueue,
    getEpisodeSuggestionFlow,
    getEpisodeSuggestionHistory,
    reviewSuggestion,
    isSuggestionAlreadyMerged,
  };
}

export function createSuggestionsService({
  episodes,
  suggestions,
  tryJson,
  mergeStringArrays,
  normalizeText,
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
        episodes.updateManualFilmTitle(suggestion.episode_id, suggestion.value);
      } else {
        const column = suggestion.suggestion_type === 'guest' ? 'manual_guests_json' : 'manual_topics_json';
        const merged = mergeStringArrays(tryJson(ep[column]), [suggestion.value]);
        episodes.updateManualArray(column, suggestion.episode_id, merged);
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
      return normalizeText(getEffectiveFilmTitle(ep)).toLowerCase() === normalizeText(value).toLowerCase();
    }
    if (suggestionType === 'guest') {
      const mergedGuests = mergeStringArrays(tryJson(ep?.guests_json), tryJson(ep?.manual_guests_json));
      return mergedGuests.some((guest) => normalizeText(guest).toLowerCase() === normalizeText(value).toLowerCase());
    }

    const mergedTopics = mergeStringArrays(tryJson(ep?.topics_json), tryJson(ep?.manual_topics_json));
    return mergedTopics.some((topic) => normalizeText(topic).toLowerCase() === normalizeText(value).toLowerCase());
  }

  return {
    getPendingQueue,
    getEpisodeSuggestionFlow,
    getEpisodeSuggestionHistory,
    reviewSuggestion,
    isSuggestionAlreadyMerged,
  };
}

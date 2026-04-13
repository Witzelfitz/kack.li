export function createPublicController({
  episodes,
  suggestions,
  meta,
  worksService,
  parseVersion,
  openaiEnabled,
  serializeEpisode,
  normalizeText,
  tryJson,
  mergeStringArrays,
  stringsInclude,
  getMergedGuests,
  getMergedTopics,
  getEffectiveFilmTitle,
  normalizeGuestEntry,
  normalizeTopicEntry,
  log,
  saveDb,
}) {
  function validationError(res, details = []) {
    return res.status(400).json({
      code: 'VALIDATION_ERROR',
      message: 'Ungültige Query-Parameter.',
      details,
    });
  }

  function parseIntegerField(value, fieldName, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
    if (value === undefined) return { ok: true, provided: false, value: null };
    const raw = String(value).trim();
    if (!/^[+-]?\d+$/.test(raw)) {
      return { ok: false, error: { field: fieldName, issue: 'must_be_integer' } };
    }
    const num = Number.parseInt(raw, 10);
    if (num < min || num > max) {
      return { ok: false, error: { field: fieldName, issue: 'out_of_range', min, max } };
    }
    return { ok: true, provided: true, value: num };
  }

  function parseStringFilter(value, fieldName, { maxLength = 120 } = {}) {
    if (value === undefined) return { ok: true, provided: false, value: '' };
    if (Array.isArray(value)) {
      return { ok: false, error: { field: fieldName, issue: 'must_be_string' } };
    }
    const normalized = String(value).trim();
    if (normalized.length > maxLength) {
      return { ok: false, error: { field: fieldName, issue: 'too_long', maxLength } };
    }
    return { ok: true, provided: true, value: normalized };
  }

  function parseBooleanField(value, fieldName) {
    if (value === undefined) return { ok: true, provided: false, value: false };
    if (Array.isArray(value)) return { ok: false, error: { field: fieldName, issue: 'must_be_boolean' } };

    const raw = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes'].includes(raw)) return { ok: true, provided: true, value: true };
    if (['0', 'false', 'no'].includes(raw)) return { ok: true, provided: true, value: false };

    return { ok: false, error: { field: fieldName, issue: 'must_be_boolean' } };
  }

  function parseDurationToSeconds(value) {
    const raw = normalizeText(value);
    if (!raw) return 0;

    if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10);

    const parts = raw.split(':').map((part) => Number.parseInt(part, 10));
    if (parts.some((part) => Number.isNaN(part) || part < 0)) return 0;

    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 1) return parts[0];
    return 0;
  }

  function getTopicFilters(req, details) {
    const topics = [];

    const search = new URL(req.originalUrl || req.url, 'http://localhost').searchParams;
    for (const value of search.getAll('topic')) topics.push(value);
    for (const value of search.getAll('topic[]')) topics.push(value);

    if (req.query.topic && !Array.isArray(req.query.topic) && !topics.length) {
      topics.push(req.query.topic);
    }

    const out = [];
    for (const value of topics) {
      const normalized = normalizeText(value);
      if (!normalized) continue;
      if (normalized.length > 120) {
        details.push({ field: 'topic[]', issue: 'too_long', maxLength: 120 });
        continue;
      }
      if (!out.includes(normalized)) out.push(normalized);
    }

    return out;
  }

  function scoreRelevance(ep, query) {
    const q = normalizeText(query).toLowerCase();
    if (!q) return 0;

    const title = normalizeText(ep.title).toLowerCase();
    const description = normalizeText(ep.description).toLowerCase();
    const summary = normalizeText(ep.summary).toLowerCase();

    let score = 0;
    if (title === q) score += 120;
    if (title.startsWith(q)) score += 80;
    if (title.includes(q)) score += 50;
    if (description.includes(q)) score += 20;
    if (summary.includes(q)) score += 10;

    return score;
  }

  return {
    listEpisodes(req, res) {
      const details = [];

      const limitResult = parseIntegerField(req.query.limit, 'limit', { min: 1, max: 100 });
      if (!limitResult.ok) details.push(limitResult.error);

      const offsetResult = parseIntegerField(req.query.offset, 'offset', { min: 0, max: Number.MAX_SAFE_INTEGER });
      if (!offsetResult.ok) details.push(offsetResult.error);

      const qResult = parseStringFilter(req.query.q, 'q', { maxLength: 200 });
      if (!qResult.ok) details.push(qResult.error);

      const guestResult = parseStringFilter(req.query.guest, 'guest', { maxLength: 120 });
      if (!guestResult.ok) details.push(guestResult.error);

      const formatResult = parseStringFilter(req.query.format, 'format', { maxLength: 120 });
      if (!formatResult.ok) details.push(formatResult.error);

      const sortResult = parseStringFilter(req.query.sort, 'sort', { maxLength: 40 });
      if (!sortResult.ok) details.push(sortResult.error);

      const hasGuestResult = parseBooleanField(req.query.has_guest, 'has_guest');
      if (!hasGuestResult.ok) details.push(hasGuestResult.error);

      const hasChaptersResult = parseBooleanField(req.query.has_chapters, 'has_chapters');
      if (!hasChaptersResult.ok) details.push(hasChaptersResult.error);

      const hasFilmTitleResult = parseBooleanField(req.query.has_film_title, 'has_film_title');
      if (!hasFilmTitleResult.ok) details.push(hasFilmTitleResult.error);

      const topics = getTopicFilters(req, details);

      const sort = sortResult.provided ? normalizeText(sortResult.value).toLowerCase() : 'pub_date';
      if (!['pub_date', 'relevance', 'duration'].includes(sort)) {
        details.push({ field: 'sort', issue: 'invalid_choice', allowed: ['pub_date', 'relevance', 'duration'] });
      }

      if (details.length) return validationError(res, details);

      const lim = limitResult.provided ? limitResult.value : 24;
      const off = offsetResult.provided ? offsetResult.value : 0;
      const q = qResult.value;
      const guest = guestResult.value;
      const format = formatResult.value;

      let where = '1=1';
      const params = [];

      if (q) {
        where += ' AND (title LIKE ? OR description LIKE ? OR format_name LIKE ? OR film_title LIKE ? OR manual_film_title LIKE ?)';
        const t = `%${q}%`;
        params.push(t, t, t, t, t);
      }
      if (guest) {
        where += ' AND (guests_json LIKE ? OR manual_guests_json LIKE ?)';
        params.push(`%${guest}%`, `%${guest}%`);
      }
      if (format) {
        where += ' AND format_name = ?';
        params.push(format);
      }
      for (const topic of topics) {
        where += ' AND (topics_json LIKE ? OR manual_topics_json LIKE ?)';
        params.push(`%${topic}%`, `%${topic}%`);
      }

      if (hasGuestResult.provided) {
        if (hasGuestResult.value) {
          where += " AND ((guests_json IS NOT NULL AND TRIM(guests_json) NOT IN ('', '[]')) OR (manual_guests_json IS NOT NULL AND TRIM(manual_guests_json) NOT IN ('', '[]')))";
        } else {
          where += " AND ((guests_json IS NULL OR TRIM(guests_json) IN ('', '[]')) AND (manual_guests_json IS NULL OR TRIM(manual_guests_json) IN ('', '[]')))";
        }
      }

      if (hasChaptersResult.provided) {
        if (hasChaptersResult.value) {
          where += " AND (chapters_json IS NOT NULL AND TRIM(chapters_json) NOT IN ('', '[]'))";
        } else {
          where += " AND (chapters_json IS NULL OR TRIM(chapters_json) IN ('', '[]'))";
        }
      }

      if (hasFilmTitleResult.provided) {
        if (hasFilmTitleResult.value) {
          where += " AND ((film_title IS NOT NULL AND TRIM(film_title) != '') OR (manual_film_title IS NOT NULL AND TRIM(manual_film_title) != ''))";
        } else {
          where += " AND ((film_title IS NULL OR TRIM(film_title) = '') AND (manual_film_title IS NULL OR TRIM(manual_film_title) = ''))";
        }
      }

      const total = episodes.count(where, params);

      let rows;
      if (sort === 'pub_date') {
        rows = episodes.list(where, params, lim, off, 'pub_ts DESC, id DESC');
      } else {
        const all = episodes.list(where, params, total || 1, 0, 'pub_ts DESC, id DESC');

        if (sort === 'relevance' && q) {
          all.sort((a, b) => {
            const byScore = scoreRelevance(b, q) - scoreRelevance(a, q);
            if (byScore !== 0) return byScore;
            return (Number.parseInt(b.pub_ts, 10) || 0) - (Number.parseInt(a.pub_ts, 10) || 0);
          });
        } else if (sort === 'duration') {
          all.sort((a, b) => {
            const byDuration = parseDurationToSeconds(b.duration) - parseDurationToSeconds(a.duration);
            if (byDuration !== 0) return byDuration;
            return (Number.parseInt(b.pub_ts, 10) || 0) - (Number.parseInt(a.pub_ts, 10) || 0);
          });
        }

        rows = all.slice(off, off + lim);
      }

      return res.json({
        total,
        limit: lim,
        offset: off,
        sort,
        filters: {
          q: q || null,
          guest: guest || null,
          topics,
          format: format || null,
          has_guest: hasGuestResult.provided ? hasGuestResult.value : null,
          has_chapters: hasChaptersResult.provided ? hasChaptersResult.value : null,
          has_film_title: hasFilmTitleResult.provided ? hasFilmTitleResult.value : null,
        },
        episodes: rows.map(serializeEpisode),
      });
    },

    getEpisodeById(req, res) {
      const ep = serializeEpisode(episodes.getById(req.params.id));
      if (!ep) return res.status(404).json({ error: 'Nicht gefunden' });
      return res.json(ep);
    },

    listGuests(_req, res) {
      const rows = episodes.guestsRows();
      const guestMap = new Map();

      for (const row of rows) {
        const merged = mergeStringArrays(tryJson(row.guests_json), tryJson(row.manual_guests_json));
        for (const rawGuest of merged) {
          const normalized = normalizeGuestEntry(rawGuest);
          if (!normalized) continue;

          if (!guestMap.has(normalized.id)) {
            guestMap.set(normalized.id, {
              id: normalized.id,
              name: normalized.name,
              aliases: new Set(normalized.aliases || []),
              count: 0,
            });
          }

          const entry = guestMap.get(normalized.id);
          entry.count += 1;

          if (normalizeText(rawGuest).toLowerCase() !== normalizeText(normalized.name).toLowerCase()) {
            entry.aliases.add(normalizeText(rawGuest));
          }
        }
      }

      return res.json(
        Array.from(guestMap.values())
          .map((entry) => ({
            id: entry.id,
            name: entry.name,
            aliases: Array.from(entry.aliases).sort((a, b) => a.localeCompare(b, 'de')),
            count: entry.count,
          }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'de'))
      );
    },

    listFormats(_req, res) {
      const rows = episodes.formatsRows();
      const counts = {};

      for (const row of rows) {
        const name = normalizeText(row.format_name);
        if (!name) continue;
        counts[name] = (counts[name] || 0) + 1;
      }

      return res.json(
        Object.entries(counts)
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'de'))
      );
    },

    listTopics(_req, res) {
      const rows = episodes.topicsRows();
      const topicMap = new Map();

      for (const row of rows) {
        const merged = mergeStringArrays(tryJson(row.topics_json), tryJson(row.manual_topics_json));
        for (const rawTopic of merged) {
          const normalized = normalizeTopicEntry(rawTopic);
          if (!normalized) continue;

          if (!topicMap.has(normalized.id)) {
            topicMap.set(normalized.id, {
              id: normalized.id,
              name: normalized.name,
              aliases: new Set(normalized.aliases || []),
              count: 0,
            });
          }

          const entry = topicMap.get(normalized.id);
          entry.count += 1;

          if (normalizeText(rawTopic).toLowerCase() !== normalizeText(normalized.name).toLowerCase()) {
            entry.aliases.add(normalizeText(rawTopic));
          }
        }
      }

      return res.json(
        Array.from(topicMap.values())
          .map((entry) => ({
            id: entry.id,
            name: entry.name,
            aliases: Array.from(entry.aliases).sort((a, b) => a.localeCompare(b, 'de')),
            count: entry.count,
          }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'de'))
      );
    },

    listWorks(req, res) {
      const details = [];

      const limitResult = parseIntegerField(req.query.limit, 'limit', { min: 1, max: 200 });
      if (!limitResult.ok) details.push(limitResult.error);

      const offsetResult = parseIntegerField(req.query.offset, 'offset', { min: 0, max: Number.MAX_SAFE_INTEGER });
      if (!offsetResult.ok) details.push(offsetResult.error);

      const qResult = parseStringFilter(req.query.q, 'q', { maxLength: 200 });
      if (!qResult.ok) details.push(qResult.error);

      if (details.length) return validationError(res, details);

      const limit = limitResult.provided ? limitResult.value : 50;
      const offset = offsetResult.provided ? offsetResult.value : 0;
      const q = qResult.value;

      return res.json(worksService.listWorks({ q, limit, offset }));
    },

    getWorkById(req, res) {
      const workId = normalizeText(req.params.id);
      if (!workId) {
        return res.status(400).json({
          code: 'VALIDATION_ERROR',
          message: 'Ungültige Work-ID.',
          details: [{ field: 'id', issue: 'required' }],
        });
      }

      const work = worksService.getWorkById(workId);
      if (!work) return res.status(404).json({ error: 'Nicht gefunden' });
      return res.json(work);
    },

    getStatus(_req, res) {
      const quality = episodes.qualityCounts();
      return res.json({
        episodes: episodes.totalCount(),
        parsed: episodes.parsedCount(parseVersion),
        last_sync: meta.get('last_sync'),
        openai: openaiEnabled,
        parse_version: parseVersion,
        quality: {
          missing_audio_url: quality.missing_audio || 0,
          missing_duration: quality.missing_duration || 0,
          target_missing_audio_url: 0,
          target_missing_duration: 0,
        },
      });
    },

    createSuggestion(req, res) {
      const episodeId = parseInt(req.params.id, 10);
      const suggestionType = normalizeText(req.body?.type).toLowerCase();
      const value = normalizeText(req.body?.value);
      const note = String(req.body?.note || '').trim();

      if (!Number.isInteger(episodeId) || episodeId <= 0) {
        return res.status(400).json({ error: 'Ungültige Episode.' });
      }
      if (!['guest', 'topic', 'film'].includes(suggestionType)) {
        return res.status(400).json({ error: 'Ungültiger Vorschlagstyp. Erlaubt sind guest, topic oder film.' });
      }
      if (value.length < 2 || value.length > 120) {
        return res.status(400).json({ error: 'Der Vorschlag muss zwischen 2 und 120 Zeichen lang sein.' });
      }
      if (note.length > 500) {
        return res.status(400).json({ error: 'Die Notiz darf maximal 500 Zeichen lang sein.' });
      }

      const ep = episodes.getById(episodeId);
      if (!ep) return res.status(404).json({ error: 'Episode nicht gefunden.' });

      if (suggestionType === 'film') {
        if (normalizeText(getEffectiveFilmTitle(ep)).toLowerCase() === value.toLowerCase()) {
          return res.status(409).json({ error: 'Dieser Filmvorschlag ist bereits übernommen.' });
        }
      } else {
        const mergedValues = suggestionType === 'guest' ? getMergedGuests(ep) : getMergedTopics(ep);
        if (stringsInclude(mergedValues, value)) {
          return res.status(409).json({ error: 'Dieser Vorschlag ist bereits übernommen.' });
        }
      }

      const pending = suggestions.findPendingDuplicate(episodeId, suggestionType, value.toLowerCase());
      if (pending) {
        return res.status(409).json({ error: 'Dieser Vorschlag wartet bereits auf Freigabe.' });
      }

      const createdAt = new Date().toISOString();
      const suggestionId = suggestions.create({
        episodeId,
        type: suggestionType,
        value,
        note,
        createdAt,
        status: 'pending',
      });

      log('suggestion', `Neuer Vorschlag für Episode #${episodeId}`, {
        episode_id: episodeId,
        suggestion_id: suggestionId,
        type: suggestionType,
        value,
      });

      saveDb();
      return res.status(201).json({ ok: true, suggestion_id: suggestionId, status: 'pending' });
    },
  };
}

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

      const topicResult = parseStringFilter(req.query.topic, 'topic', { maxLength: 120 });
      if (!topicResult.ok) details.push(topicResult.error);

      const formatResult = parseStringFilter(req.query.format, 'format', { maxLength: 120 });
      if (!formatResult.ok) details.push(formatResult.error);

      if (details.length) return validationError(res, details);

      const lim = limitResult.provided ? limitResult.value : 24;
      const off = offsetResult.provided ? offsetResult.value : 0;
      const q = qResult.value;
      const guest = guestResult.value;
      const topic = topicResult.value;
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
      if (topic) {
        where += ' AND (topics_json LIKE ? OR manual_topics_json LIKE ?)';
        params.push(`%${topic}%`, `%${topic}%`);
      }
      if (format) {
        where += ' AND format_name = ?';
        params.push(format);
      }

      const total = episodes.count(where, params);
      const rows = episodes.list(where, params, lim, off).map(serializeEpisode);
      return res.json({ total, limit: lim, offset: off, episodes: rows });
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

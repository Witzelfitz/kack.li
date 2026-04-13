export function createPublicController({
  episodes,
  suggestions,
  meta,
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
  log,
  saveDb,
}) {
  return {
    listEpisodes(req, res) {
      const { q, guest, topic, format, limit = 24, offset = 0 } = req.query;
      const lim = Math.min(parseInt(limit, 10) || 24, 100);
      const off = parseInt(offset, 10) || 0;

      let where = '1=1';
      const params = [];

      if (q?.trim()) {
        where += ' AND (title LIKE ? OR description LIKE ? OR format_name LIKE ? OR film_title LIKE ? OR manual_film_title LIKE ?)';
        const t = `%${q.trim()}%`;
        params.push(t, t, t, t, t);
      }
      if (guest?.trim()) {
        where += ' AND (guests_json LIKE ? OR manual_guests_json LIKE ?)';
        params.push(`%${guest.trim()}%`, `%${guest.trim()}%`);
      }
      if (topic?.trim()) {
        where += ' AND (topics_json LIKE ? OR manual_topics_json LIKE ?)';
        params.push(`%${topic.trim()}%`, `%${topic.trim()}%`);
      }
      if (format?.trim()) {
        where += ' AND format_name = ?';
        params.push(format.trim());
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
      const counts = {};

      for (const row of rows) {
        for (const g of mergeStringArrays(tryJson(row.guests_json), tryJson(row.manual_guests_json))) {
          counts[g] = (counts[g] || 0) + 1;
        }
      }

      return res.json(
        Object.entries(counts)
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
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
      const counts = {};

      for (const row of rows) {
        for (const topic of mergeStringArrays(tryJson(row.topics_json), tryJson(row.manual_topics_json))) {
          counts[topic] = (counts[topic] || 0) + 1;
        }
      }

      return res.json(
        Object.entries(counts)
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
      );
    },

    getStatus(_req, res) {
      return res.json({
        episodes: episodes.totalCount(),
        parsed: episodes.parsedCount(parseVersion),
        last_sync: meta.get('last_sync'),
        openai: openaiEnabled,
        parse_version: parseVersion,
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

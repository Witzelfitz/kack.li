export function createAdminController({
  episodes,
  logs,
  suggestions,
  normalizeText,
  tryJson,
  mergeStringArrays,
  log,
  saveDb,
  parseService,
  episodesService,
}) {
  return {
    listLogs(req, res) {
      const { limit = 100, event, level } = req.query;
      const lim = Math.min(parseInt(limit, 10) || 100, 500);

      let where = '1=1';
      const params = [];

      if (event) {
        where += ' AND event = ?';
        params.push(event);
      }
      if (level) {
        where += ' AND level = ?';
        params.push(level);
      }

      const rows = logs.list(where, params, lim);
      const total = logs.count(where, params);
      return res.json({ total, logs: rows });
    },

    listSuggestions(req, res) {
      const { limit = 100, status = 'pending', type, episode_id } = req.query;
      const lim = Math.min(parseInt(limit, 10) || 100, 500);

      let where = '1=1';
      const params = [];

      if (status) {
        where += ' AND s.status = ?';
        params.push(String(status));
      }
      if (type) {
        where += ' AND s.suggestion_type = ?';
        params.push(String(type));
      }
      if (episode_id) {
        where += ' AND s.episode_id = ?';
        params.push(parseInt(episode_id, 10) || 0);
      }

      const rows = suggestions.listWithEpisodeTitle(where, params, lim);
      const total = suggestions.countWithEpisodeTitle(where, params);
      return res.json({ total, suggestions: rows });
    },

    reviewSuggestion(req, res) {
      const suggestionId = parseInt(req.params.id, 10);
      const action = normalizeText(req.body?.action).toLowerCase();
      const reviewNote = String(req.body?.review_note || '').trim();

      if (!Number.isInteger(suggestionId) || suggestionId <= 0) {
        return res.status(400).json({ error: 'Ungültige Suggestion-ID.' });
      }
      if (!['approve', 'reject'].includes(action)) {
        return res.status(400).json({ error: 'Ungültige Aktion. Erlaubt sind approve oder reject.' });
      }
      if (reviewNote.length > 500) {
        return res.status(400).json({ error: 'Die Review-Notiz darf maximal 500 Zeichen lang sein.' });
      }

      const suggestion = suggestions.getById(suggestionId);
      if (!suggestion) return res.status(404).json({ error: 'Suggestion nicht gefunden.' });
      if (suggestion.status !== 'pending') {
        return res.status(409).json({ error: 'Diese Suggestion wurde bereits bearbeitet.' });
      }

      if (action === 'approve') {
        const ep = episodes.getById(suggestion.episode_id);
        if (!ep) return res.status(404).json({ error: 'Episode nicht gefunden.' });

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
      suggestions.markReviewed(suggestionId, newStatus, reviewedAt, reviewNote || null);

      log('suggestion-review', `Suggestion #${suggestionId} ${action === 'approve' ? 'freigegeben' : 'abgelehnt'}`, {
        suggestion_id: suggestionId,
        episode_id: suggestion.episode_id,
        type: suggestion.suggestion_type,
        value: suggestion.value,
      });

      saveDb();
      return res.json({
        ok: true,
        id: suggestionId,
        status: newStatus,
        episode_id: suggestion.episode_id,
        type: suggestion.suggestion_type,
        value: suggestion.value,
      });
    },

    async sync(_req, res) {
      try {
        return res.json({ ok: true, ...(await episodesService.syncFeed()) });
      } catch (err) {
        log('sync', `Fehler: ${err.message}`, null, 'error');
        return res.status(500).json({ ok: false, error: err.message });
      }
    },

    async parseEpisode(req, res) {
      if (!parseService.enabled) return res.status(503).json({ error: 'OPENAI_API_KEY nicht gesetzt' });

      const ep = episodes.getById(req.params.id);
      if (!ep) return res.status(404).json({ error: 'Nicht gefunden' });

      try {
        const data = await episodesService.parseSingleEpisode(ep);
        return res.json({ ok: true, ...data });
      } catch (err) {
        log('parse', `Fehler Episode #${ep.id}: ${err.message}`, { episode_id: ep.id }, 'error');
        return res.status(500).json({ error: err.message });
      }
    },

    parseFilms(req, res) {
      if (!parseService.enabled) return res.status(503).json({ error: 'OPENAI_API_KEY nicht gesetzt' });

      const force = req.query.force === '1';
      const queued = episodesService.startParseFilmsJob(force);
      return res.json({ ok: true, queued });
    },

    parseAll(req, res) {
      if (!parseService.enabled) return res.status(503).json({ error: 'OPENAI_API_KEY nicht gesetzt' });

      const force = req.query.force === '1';
      const queued = episodesService.startParseAllJob(force);
      return res.json({ ok: true, queued });
    },
  };
}

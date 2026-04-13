export function createJarvisController({ normalizeText, suggestionsService }) {
  return {
    listPending(req, res) {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 200);
      const queue = suggestionsService.getPendingQueue(limit);
      return res.json({ total: queue.length, suggestions: queue });
    },

    reviewSuggestion(req, res) {
      const suggestionId = parseInt(req.params.id, 10);
      const action = normalizeText(req.body?.action).toLowerCase();
      const reviewNote = String(req.body?.review_note || req.body?.note || '').trim();
      const reviewedBy = String(req.body?.reviewed_by || req.body?.reviewer || 'jarvis').trim();
      const reviewSource = normalizeText(req.body?.review_source || 'jarvis-bot') || 'jarvis-bot';

      if (!Number.isInteger(suggestionId) || suggestionId <= 0) {
        return res.status(400).json({ error: 'Ungültige Suggestion-ID.' });
      }
      if (!['approve', 'reject'].includes(action)) {
        return res.status(400).json({ error: 'Ungültige Aktion. Erlaubt sind approve oder reject.' });
      }
      if (reviewNote.length > 500) {
        return res.status(400).json({ error: 'Die Review-Notiz darf maximal 500 Zeichen lang sein.' });
      }

      const result = suggestionsService.reviewSuggestion({
        suggestionId,
        action,
        reviewNote,
        reviewedBy,
        reviewSource,
      });

      if (!result.ok) return res.status(result.status).json({ error: result.error });
      return res.json(result);
    },
  };
}

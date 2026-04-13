export function createJarvisController({ normalizeText, suggestionsService, jarvisNotifier }) {
  function renderReviewResultHtml({ title, message }) {
    return `<!doctype html>
<html lang="de">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#0f1217;color:#e9eef5;padding:32px}main{max-width:640px;margin:0 auto;background:#151a22;border:1px solid #2a3342;border-radius:12px;padding:24px}h1{font-size:20px;margin:0 0 12px}p{line-height:1.6;color:#c6d0dc}</style></head>
<body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;
  }

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

    reviewViaLink(req, res) {
      const suggestionId = parseInt(req.query.sid, 10);
      const action = normalizeText(req.query.action).toLowerCase();
      const exp = req.query.exp;
      const sig = req.query.sig;

      if (!Number.isInteger(suggestionId) || suggestionId <= 0 || !['approve', 'reject'].includes(action)) {
        return res.status(400).send(renderReviewResultHtml({ title: 'Ungültiger Link', message: 'Der Review-Link ist nicht gültig.' }));
      }

      const check = jarvisNotifier?.verifyReviewLink({ suggestionId, action, exp, sig });
      if (!check?.ok) {
        return res.status(401).send(renderReviewResultHtml({ title: 'Link ungültig', message: 'Der Link ist abgelaufen oder die Signatur stimmt nicht.' }));
      }

      const result = suggestionsService.reviewSuggestion({
        suggestionId,
        action,
        reviewNote: 'Telegram-Button',
        reviewedBy: 'jarvis-telegram',
        reviewSource: 'telegram-link',
      });

      if (!result.ok) {
        return res.status(result.status).send(
          renderReviewResultHtml({
            title: 'Review nicht möglich',
            message: result.error || 'Die Suggestion konnte nicht bearbeitet werden.',
          })
        );
      }

      const message = action === 'approve'
        ? `Suggestion #${suggestionId} wurde erfolgreich freigegeben.`
        : `Suggestion #${suggestionId} wurde erfolgreich abgelehnt.`;

      return res.status(200).send(renderReviewResultHtml({ title: 'Erledigt ✅', message }));
    },
  };
}

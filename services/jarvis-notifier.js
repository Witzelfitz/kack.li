import crypto from 'crypto';

function firstNonEmpty(...values) {
  return values.map((v) => String(v || '').trim()).find(Boolean) || '';
}

function resolveTelegramChatId(env) {
  const raw = firstNonEmpty(
    env.ALLOWED_CHAT_ID,
    env.TELEGRAM_FEATURE_CHAT_ID,
    env.FEATURE_REQUEST_TELEGRAM_CHAT_ID,
    env.TELEGRAM_CHAT_ID,
    env.TG_CHAT_ID,
    env.CHAT_ID
  );

  if (!raw) return '';
  return raw
    .split(',')
    .map((v) => v.trim())
    .find(Boolean)
    ?.replace(/^telegram:/i, '') || '';
}

function safeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function createJarvisNotifier({ env = process.env, log = () => {} } = {}) {
  const telegramToken = firstNonEmpty(
    env.TELEGRAM_BOT_TOKEN,
    env.TELEGRAM_TOKEN,
    env.BOT_TOKEN,
    env.TG_BOT_TOKEN,
    env.FEATURE_REQUEST_TELEGRAM_BOT_TOKEN
  );

  const chatId = resolveTelegramChatId(env);
  const baseUrl = firstNonEmpty(env.APP_BASE_URL, env.BASE_URL, env.PUBLIC_BASE_URL);
  const reviewSecret = firstNonEmpty(env.JARVIS_LINK_SECRET, env.JARVIS_REVIEW_TOKEN, env.ADMIN_TOKEN, env.TELEGRAM_BOT_TOKEN);

  const enabled = Boolean(telegramToken && chatId && reviewSecret);

  function signPayload(suggestionId, action, expiresAt) {
    const payload = `${suggestionId}:${action}:${expiresAt}`;
    return crypto.createHmac('sha256', reviewSecret).update(payload).digest('hex');
  }

  function createReviewLink({ suggestionId, action, expiresInHours = 72, requestBaseUrl = '' }) {
    if (!reviewSecret) return null;
    const expiresAt = Math.floor(Date.now() / 1000) + Math.max(1, expiresInHours) * 3600;
    const sig = signPayload(suggestionId, action, expiresAt);

    const host = firstNonEmpty(requestBaseUrl, baseUrl);
    if (!host) return null;

    const url = new URL('/internal/jarvis/review-link', host);
    url.searchParams.set('sid', String(suggestionId));
    url.searchParams.set('action', action);
    url.searchParams.set('exp', String(expiresAt));
    url.searchParams.set('sig', sig);
    return url.toString();
  }

  function verifyReviewLink({ suggestionId, action, exp, sig }) {
    if (!reviewSecret) return { ok: false, reason: 'missing_secret' };
    const expiresAt = Number.parseInt(exp, 10);
    if (!Number.isInteger(expiresAt) || expiresAt <= 0) return { ok: false, reason: 'invalid_exp' };
    const now = Math.floor(Date.now() / 1000);
    if (expiresAt < now) return { ok: false, reason: 'expired' };

    const expected = signPayload(suggestionId, action, expiresAt);
    const a = Buffer.from(String(sig || ''), 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { ok: false, reason: 'invalid_signature' };
    }

    return { ok: true };
  }

  async function notifySuggestionCreated({ suggestion, episodeTitle, requestBaseUrl = '' }) {
    if (!enabled) return { ok: false, skipped: 'not_configured' };
    if (!suggestion?.id) return { ok: false, skipped: 'missing_suggestion_id' };

    const approveUrl = createReviewLink({
      suggestionId: suggestion.id,
      action: 'approve',
      requestBaseUrl,
    });
    const rejectUrl = createReviewLink({
      suggestionId: suggestion.id,
      action: 'reject',
      requestBaseUrl,
    });

    if (!approveUrl || !rejectUrl) {
      log('jarvis-notify', 'Review-Links konnten nicht erstellt werden (fehlende Base-URL?)', {
        suggestion_id: suggestion.id,
      }, 'error');
      return { ok: false, skipped: 'missing_base_url' };
    }

    const text = [
      '🧩 <b>Neuer Community-Vorschlag</b>',
      `Episode: <b>${safeHtml(episodeTitle || `#${suggestion.episode_id}`)}</b>`,
      `Typ: <b>${safeHtml(suggestion.type || '')}</b>`,
      `Wert: <b>${safeHtml(suggestion.value || '')}</b>`,
      suggestion.note ? `Notiz: ${safeHtml(suggestion.note)}` : null,
      `Suggestion-ID: <code>${safeHtml(suggestion.id)}</code>`,
    ]
      .filter(Boolean)
      .join('\n');

    const payload = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Approve', url: approveUrl },
            { text: '❌ Decline', url: rejectUrl },
          ],
        ],
      },
      disable_web_page_preview: true,
    };

    const response = await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text();
      log('jarvis-notify', `Telegram sendMessage fehlgeschlagen: ${response.status}`, {
        suggestion_id: suggestion.id,
        response: body,
      }, 'error');
      return { ok: false, status: response.status, error: body };
    }

    return { ok: true };
  }

  return {
    enabled,
    createReviewLink,
    verifyReviewLink,
    notifySuggestionCreated,
  };
}

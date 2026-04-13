function extractBearerToken(req) {
  return (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
}

export function createRequireAdmin(adminToken) {
  return function requireAdmin(req, res, next) {
    const token = extractBearerToken(req);
    if (!adminToken || token !== adminToken) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  };
}

export function createRequireApiToken(validTokens = []) {
  const normalized = validTokens
    .map((token) => String(token || '').trim())
    .filter(Boolean);

  return function requireApiToken(req, res, next) {
    const token = extractBearerToken(req);
    if (!normalized.length || !token || !normalized.includes(token)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  };
}

export function resolveJarvisTokens(env = process.env) {
  const raw = [
    env.JARVIS_REVIEW_TOKEN,
    env.JARVIS_BOT_REVIEW_TOKEN,
    env.JARVIS_BOT_TOKEN,
    env.JARVIS_TOKEN,
    env.TELEGRAM_BOT_TOKEN,
    env.BOT_TOKEN,
    env.TG_BOT_TOKEN,
  ]
    .map((value) => String(value || '').trim())
    .find(Boolean);

  if (!raw) return [];
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

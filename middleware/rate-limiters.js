import rateLimit from 'express-rate-limit';

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const API_RATE_LIMIT_WINDOW_MS = parsePositiveInt(process.env.API_RATE_LIMIT_WINDOW_MS, 60 * 1000);
const API_RATE_LIMIT_MAX = parsePositiveInt(process.env.API_RATE_LIMIT_MAX, 300);
const API_RATE_LIMIT_BYPASS_KEY = String(process.env.API_RATE_LIMIT_BYPASS_KEY || '').trim();

const SUGGESTION_RATE_LIMIT_WINDOW_MS = parsePositiveInt(
  process.env.SUGGESTION_RATE_LIMIT_WINDOW_MS,
  60 * 60 * 1000
);
const SUGGESTION_RATE_LIMIT_MAX = parsePositiveInt(process.env.SUGGESTION_RATE_LIMIT_MAX, 10);

function isBypassed(req) {
  if (!API_RATE_LIMIT_BYPASS_KEY) return false;

  const headerKey =
    String(req.headers['x-load-test-key'] || '').trim() ||
    String(req.headers['x-rate-limit-bypass'] || '').trim();

  return Boolean(headerKey) && headerKey === API_RATE_LIMIT_BYPASS_KEY;
}

export const publicLimiter = rateLimit({
  windowMs: API_RATE_LIMIT_WINDOW_MS,
  max: API_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isBypassed,
  message: { error: 'Zu viele Anfragen, bitte später erneut versuchen.' },
});

export const suggestionLimiter = rateLimit({
  windowMs: SUGGESTION_RATE_LIMIT_WINDOW_MS,
  max: SUGGESTION_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Vorschläge in kurzer Zeit, bitte später erneut versuchen.' },
});

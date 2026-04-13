import { FORMAT_DEFINITIONS, RSS_URL } from '../config/constants.js';

export function tryJson(str) {
  if (!str) return [];
  try {
    const value = JSON.parse(str);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function tryJsonObject(str) {
  if (!str) return {};
  try {
    const value = JSON.parse(str);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function normalizeText(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

export function detectEpisodeFormat(title) {
  const value = String(title || '').trim();
  if (!value) return null;
  for (const def of FORMAT_DEFINITIONS) {
    if (def.pattern.test(value)) return def.name;
  }
  return null;
}

export function cleanEpisodeTitle(title) {
  return normalizeText(
    String(title || '')
      .replace(/^#\d+\s*:\s*/i, '')
      .replace(/^BONUS\s*:\s*/i, '')
      .replace(/\s+\|\s+feat\..*$/i, '')
  );
}

export function normalizeFilmTitle(value) {
  const title = normalizeText(value);
  if (!title) return null;
  if (/^(null|none|n\/a|kein(?:e|er)?|unklar|unknown)$/i.test(title)) return null;
  return title;
}

export function uniqueStrings(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const text = normalizeText(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

export function mergeStringArrays(...values) {
  return uniqueStrings(values.flat());
}

export function stringsInclude(values, target) {
  const normalizedTarget = normalizeText(target).toLowerCase();
  if (!normalizedTarget) return false;
  return values.some((value) => normalizeText(value).toLowerCase() === normalizedTarget);
}

export function getMergedGuests(ep) {
  return mergeStringArrays(tryJson(ep?.guests_json), tryJson(ep?.manual_guests_json));
}

export function getMergedTopics(ep) {
  return mergeStringArrays(tryJson(ep?.topics_json), tryJson(ep?.manual_topics_json));
}

export function getEffectiveFilmTitle(ep) {
  return normalizeFilmTitle(ep?.manual_film_title) || normalizeFilmTitle(ep?.film_title);
}

export function mergeEpisodeCommunityData(ep) {
  if (!ep) return null;
  return {
    ...ep,
    format_name: ep.format_name || detectEpisodeFormat(ep.title),
    film_title: getEffectiveFilmTitle(ep),
    guests_json: JSON.stringify(getMergedGuests(ep)),
    topics_json: JSON.stringify(getMergedTopics(ep)),
  };
}

export function normalizeChapters(values) {
  if (!Array.isArray(values)) return [];
  const out = [];
  for (const chapter of values) {
    if (!chapter || typeof chapter !== 'object') continue;
    const time = normalizeText(chapter.time);
    const title = normalizeText(chapter.title);
    if (!time || !title) continue;
    out.push({ time, title });
  }
  return out;
}

export function sanitizeHttpUrl(value, base = null) {
  if (!value) return '';
  try {
    const url = base ? new URL(String(value).trim(), base) : new URL(String(value).trim());
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

export function serializeEpisode(ep) {
  if (!ep) return null;
  const merged = mergeEpisodeCommunityData(ep);
  const { manual_film_title, manual_guests_json, manual_topics_json, ...publicEpisode } = merged;
  return {
    ...publicEpisode,
    audio_url: sanitizeHttpUrl(publicEpisode.audio_url, RSS_URL),
    image_url: sanitizeHttpUrl(publicEpisode.image_url, RSS_URL),
    link: sanitizeHttpUrl(publicEpisode.link, RSS_URL),
  };
}

export function stripHtml(str) {
  return (str || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#[0-9]+;/g, '')
    .trim();
}

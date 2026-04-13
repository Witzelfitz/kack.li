import { FORMAT_DEFINITIONS, RSS_URL } from '../config/constants.js';
import { GUEST_MODEL } from '../config/guest-model.js';
import { TOPIC_MODEL } from '../config/topic-model.js';

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

function normalizeLookupKey(value) {
  return normalizeText(String(value || '').toLowerCase())
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractGuestCoreName(value) {
  let text = normalizeText(value);
  if (!text) return '';

  text = text
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\baka\.?\s+.*$/i, '')
    .replace(/,.*$/g, '')
    .replace(/\s+-\s+.*$/g, ' ');

  return normalizeText(text);
}

function slugifyGuestId(value) {
  const cleaned = normalizeLookupKey(value)
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
  return cleaned || 'unknown';
}

const GUEST_BY_ID = new Map(GUEST_MODEL.map((guest) => [guest.id, guest]));
const GUEST_ALIAS_INDEX = new Map();

for (const guest of GUEST_MODEL) {
  const aliases = [guest.name, ...(guest.aliases || [])];
  for (const alias of aliases) {
    const direct = normalizeLookupKey(alias);
    const core = normalizeLookupKey(extractGuestCoreName(alias));
    if (direct) GUEST_ALIAS_INDEX.set(direct, guest.id);
    if (core) GUEST_ALIAS_INDEX.set(core, guest.id);
  }
}

const TOPIC_BY_ID = new Map(TOPIC_MODEL.map((topic) => [topic.id, topic]));
const TOPIC_ALIAS_INDEX = new Map();

for (const topic of TOPIC_MODEL) {
  const aliases = [topic.name, ...(topic.aliases || [])];
  for (const alias of aliases) {
    const key = normalizeLookupKey(alias);
    if (key) TOPIC_ALIAS_INDEX.set(key, topic.id);
  }
}

export function normalizeGuestEntry(value) {
  const raw = normalizeText(value);
  if (!raw) return null;

  const directKey = normalizeLookupKey(raw);
  const coreName = extractGuestCoreName(raw) || raw;
  const coreKey = normalizeLookupKey(coreName);
  const matchedId = GUEST_ALIAS_INDEX.get(directKey) || GUEST_ALIAS_INDEX.get(coreKey);

  if (matchedId) {
    const canonical = GUEST_BY_ID.get(matchedId) || { id: matchedId, name: coreName, aliases: [] };
    return {
      id: canonical.id,
      name: canonical.name,
      aliases: canonical.aliases || [],
      raw,
      matched: true,
    };
  }

  return {
    id: `guest-${slugifyGuestId(coreName)}`,
    name: coreName,
    aliases: [],
    raw,
    matched: false,
  };
}

export function normalizeGuestList(values) {
  if (!Array.isArray(values)) return [];
  const byId = new Map();

  for (const value of values) {
    const normalized = normalizeGuestEntry(value);
    if (!normalized) continue;
    if (!byId.has(normalized.id)) {
      byId.set(normalized.id, normalized.name);
    }
  }

  return Array.from(byId.values());
}

export function normalizeTopicEntry(value) {
  const raw = normalizeText(value);
  if (!raw) return null;

  const key = normalizeLookupKey(raw);
  const matchedId = TOPIC_ALIAS_INDEX.get(key);

  if (matchedId) {
    const canonical = TOPIC_BY_ID.get(matchedId) || { id: matchedId, name: raw, aliases: [] };
    return {
      id: canonical.id,
      name: canonical.name,
      aliases: canonical.aliases || [],
      raw,
      matched: true,
    };
  }

  return {
    id: `topic-${slugifyGuestId(raw)}`,
    name: raw,
    aliases: [],
    raw,
    matched: false,
  };
}

export function normalizeTopicList(values) {
  if (!Array.isArray(values)) return [];
  const byId = new Map();

  for (const value of values) {
    const normalized = normalizeTopicEntry(value);
    if (!normalized) continue;
    if (!byId.has(normalized.id)) {
      byId.set(normalized.id, normalized.name);
    }
  }

  return Array.from(byId.values());
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

export function getWorkIdFromFilmTitle(value) {
  const filmTitle = normalizeFilmTitle(value);
  if (!filmTitle) return null;
  return `work-${slugifyGuestId(filmTitle)}`;
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

export function getAiGuests(ep) {
  return normalizeGuestList(tryJson(ep?.guests_json));
}

export function getCommunityGuests(ep) {
  return normalizeGuestList(tryJson(ep?.manual_guests_json));
}

export function getMergedGuests(ep) {
  return mergeStringArrays(getAiGuests(ep), getCommunityGuests(ep));
}

export function getAiTopics(ep) {
  return normalizeTopicList(tryJson(ep?.topics_json));
}

export function getCommunityTopics(ep) {
  return normalizeTopicList(tryJson(ep?.manual_topics_json));
}

export function getMergedTopics(ep) {
  return mergeStringArrays(getAiTopics(ep), getCommunityTopics(ep));
}

export function getEffectiveFilmTitle(ep) {
  return normalizeFilmTitle(ep?.manual_film_title) || normalizeFilmTitle(ep?.film_title);
}

export function getFilmSourceData(ep) {
  const ai = normalizeFilmTitle(ep?.film_title);
  const community = normalizeFilmTitle(ep?.manual_film_title);
  const effective = community || ai || null;
  const source = community ? 'community' : ai ? 'ai' : null;

  return {
    effective,
    source,
    ai,
    community,
  };
}

export function mergeEpisodeCommunityData(ep) {
  if (!ep) return null;

  const guestsAi = getAiGuests(ep);
  const guestsCommunity = getCommunityGuests(ep);
  const topicsAi = getAiTopics(ep);
  const topicsCommunity = getCommunityTopics(ep);
  const film = getFilmSourceData(ep);

  return {
    ...ep,
    format_name: ep.format_name || detectEpisodeFormat(ep.title),
    film_title: film.effective,
    film_title_source: film.source,
    film_title_ai: film.ai,
    film_title_community: film.community,
    work_id: getWorkIdFromFilmTitle(film.effective),
    guests: mergeStringArrays(guestsAi, guestsCommunity),
    guests_ai: guestsAi,
    guests_community: guestsCommunity,
    topics: mergeStringArrays(topicsAi, topicsCommunity),
    topics_ai: topicsAi,
    topics_community: topicsCommunity,
    chapters: normalizeChapters(tryJson(ep?.chapters_json)),
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
  const {
    manual_film_title,
    manual_guests_json,
    manual_topics_json,
    guests_json,
    topics_json,
    chapters_json,
    episode_num,
    ...publicEpisode
  } = merged;

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

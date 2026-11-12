import { createHash } from 'node:crypto';
import { serializeEpisode, normalizeGuestEntry, normalizeTopicEntry, normalizeText, stripHtml } from './episode-utils.js';

export const SEARCH_SCHEMA = 1;
export const SEARCH_PIPELINE = 'episode-clean-v1';

export function cleanDescription(value) {
  return normalizeText(stripHtml(String(value || '')
    .split(/(?:_{3,}\s*(?:&nbsp;)?\s*WERBUNG|\bWERBUNG\s*[:\n]|\bLINKTREE\b|\bUNSERE WERBEPARTNER\b)/i)[0]
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/(?:^|\n)\s*-\s*-\s*-/g, '\n'))).slice(0, 5500);
}

export function buildSearchDocument(row) {
  const ep = serializeEpisode(row);
  const guests = (ep.guests || []).map(normalizeGuestEntry).filter(Boolean);
  const topics = (ep.topics || []).map(normalizeTopicEntry).filter(Boolean);
  const document = {
    id: ep.id,
    title: ep.title || '',
    work: ep.film_title || '',
    format: ep.format_name || '',
    description: cleanDescription(ep.description || ep.summary),
    guests: guests.map((x) => [x.name, ...x.aliases].join(' ')).join(' '),
    topics: topics.map((x) => [x.name, ...x.aliases].join(' ')).join(' '),
    chapters: (ep.chapters || []).map((x) => x.title).join(' '),
  };
  const text = [document.title, document.work, document.format,
    `Gäste: ${guests.map((x) => x.name).join(', ')}`,
    `Themen: ${topics.map((x) => x.name).join(', ')}`,
    document.description, document.chapters].join('\n').slice(0, 7000);
  return { ...document, text, hash: createHash('sha256').update(SEARCH_PIPELINE + text).digest('hex'),
    guestIds: [...new Set(guests.map((x) => x.id))], topicIds: [...new Set(topics.map((x) => x.id))], episode: ep };
}

export function normalizeVector(vector) {
  if (!Array.isArray(vector) || !vector.length || vector.some((x) => !Number.isFinite(x))) throw new Error('Invalid embedding');
  const norm = Math.hypot(...vector);
  if (!norm) throw new Error('Zero embedding');
  return vector.map((x) => x / norm);
}

export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return -1;
  let score = 0;
  for (let i = 0; i < a.length; i++) score += a[i] * b[i];
  return score;
}

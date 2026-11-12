import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createDatabase } from '../models/database.js';
import { createRepositories } from '../models/repositories.js';
import { buildSearchDocument, cosine, SEARCH_SCHEMA, SEARCH_PIPELINE } from '../lib/search-documents.js';
import { normalizeGuestEntry, normalizeTopicEntry } from '../lib/episode-utils.js';
import { createEmbeddingService } from '../services/embedding-service.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.resolve(process.env.SEARCH_INDEX_PATH || path.join(root, 'data/search-index.json'));
const embedder = createEmbeddingService({ baseUrl: process.env.EMBEDDING_BASE_URL || 'http://127.0.0.1:11434',
  authorization: process.env.EMBEDDING_AUTHORIZATION,
  model: process.env.EMBEDDING_MODEL || 'embeddinggemma', timeoutMs: 120000 });
const identity = await embedder.identity();
const database = await createDatabase(process.env.DB_FILE || path.join(root, 'episodes.db'));
const { episodes } = createRepositories(database);
const documents = episodes.searchRows().map(buildSearchDocument);
let previous;
try { previous = JSON.parse(fs.readFileSync(output, 'utf8')); } catch { /* First build. */ }
const reusable = previous?.digest === identity.digest && previous?.pipeline === SEARCH_PIPELINE && previous?.schema === SEARCH_SCHEMA;
const oldEpisodes = new Map((reusable ? previous.episodes : []).map((x) => [x.id, x]));
const entries = documents.map((doc) => ({ id: doc.id, hash: doc.hash, text: doc.text }));

async function encode(items, old, task) {
  let completed = 0;
  for (const item of items) {
    const cached = old.get(item.id);
    if (cached?.hash === item.hash && Array.isArray(cached.vector)) { item.vector = cached.vector; completed++; }
  }
  const missing = items.filter((item) => !item.vector);
  for (let offset = 0; offset < missing.length; offset += 12) {
    const batch = missing.slice(offset, offset + 12);
    const vectors = await embedder.embed(batch.map((item) => item.text), task);
    batch.forEach((item, i) => { item.vector = vectors[i]; });
    completed += batch.length;
    console.log(`${task}: ${completed}/${items.length}`);
  }
  return items.map(({ text, ...item }) => item);
}

const encodedEpisodes = await encode(entries, oldEpisodes, 'document');
const entityMap = new Map();
for (const doc of documents) {
  for (const type of ['topic', 'guest', 'work']) {
    const entities = type === 'work' ? (doc.work ? [{ id: doc.episode.work_id, name: doc.work }] : [])
      : (type === 'topic' ? doc.episode.topics.map(normalizeTopicEntry) : doc.episode.guests.map(normalizeGuestEntry));
    for (const entity of new Map(entities.filter(Boolean).map((item) => [item.id, item])).values()) {
      const key = `${type}:${entity.id}`;
      if (!entityMap.has(key)) entityMap.set(key, { id: key, entity_id: entity.id, name: entity.name, type, count: 0, examples: [] });
      const item = entityMap.get(key);
      item.count++;
      if (item.examples.length < 3) item.examples.push({ id: doc.id, title: doc.title });
    }
  }
}
const entities = [...entityMap.values()].map((item) => ({ ...item, text: item.name,
  hash: createHash('sha256').update('cluster-v1:' + item.name).digest('hex') }));
const oldEntities = new Map((reusable ? previous.entities || [] : []).map((item) => [item.id, item]));
const encodedEntities = await encode(entities, oldEntities, 'cluster');
const candidates = [];
const threshold = Number(process.env.CLUSTER_MIN_SIMILARITY) || 0.82;
for (const type of ['topic', 'guest', 'work']) {
  const group = encodedEntities.filter((item) => item.type === type);
  const pairs = [];
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      const score = cosine(group[i].vector, group[j].vector);
      if (score < threshold) continue;
      const [source, target] = group[i].count <= group[j].count ? [group[i], group[j]] : [group[j], group[i]];
      const publicEntity = (item) => ({ id: item.entity_id, name: item.name, count: item.count, examples: item.examples });
      const numbers = (value) => [...value.toLowerCase().matchAll(/\b(?:teil|episode|staffel|part)\s+([ivxlcdm]+|\d+)\b|\b(\d+k?)\b/g)].map((m) => m[1] || m[2]).join(',');
      const distinctNumbers = numbers(source.name) !== numbers(target.name) && Boolean(numbers(source.name) || numbers(target.name));
      const mergeAllowed = type !== 'work' && !distinctNumbers;
      pairs.push({ id: createHash('sha256').update(`${identity.digest}:${type}:${source.id}:${target.id}:${source.hash}:${target.hash}`).digest('hex').slice(0, 24),
        type, source: publicEntity(source), target: publicEntity(target), similarity: Math.round(score * 10000) / 10000,
        model: identity.model, merge_allowed: mergeAllowed, recommendation: mergeAllowed ? 'review' : 'related' });
    }
  }
  candidates.push(...pairs.sort((a, b) => b.similarity - a.similarity).slice(0, 150));
}
const dimensions = encodedEpisodes[0]?.vector.length || 0;
const data = { schema: SEARCH_SCHEMA, pipeline: SEARCH_PIPELINE, ...identity, dimensions,
  retrieval: { min_similarity: identity.model.includes('embeddinggemma-2') ? 0.68 : 0.28, score_window: identity.model.includes('embeddinggemma-2') ? 0.025 : 0.08 },
  created_at: new Date().toISOString(), episodes: encodedEpisodes, entities: encodedEntities, cluster_candidates: candidates };
fs.mkdirSync(path.dirname(output), { recursive: true });
const temp = `${output}.${process.pid}.tmp`;
fs.writeFileSync(temp, JSON.stringify(data) + '\n', { mode: 0o600 });
fs.renameSync(temp, output);
console.log(JSON.stringify({ output, model: identity.model, dimensions, episodes: documents.length, entities: entities.length, candidates: candidates.length }));

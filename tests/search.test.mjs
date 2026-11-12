import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createDatabase } from '../models/database.js';
import { createRepositories } from '../models/repositories.js';
import { buildSearchDocument, cleanDescription, normalizeVector, SEARCH_SCHEMA, SEARCH_PIPELINE } from '../lib/search-documents.js';
import { createSearchService } from '../services/search-service.js';
import { createEmbeddingService } from '../services/embedding-service.js';
import { createClusterService } from '../services/cluster-service.js';
import { createPublicController } from '../controllers/public-controller.js';
import { createAdminController } from '../controllers/admin-controller.js';
import { createPublicRoutes } from '../routes/public-routes.js';
import { createAdminRoutes } from '../routes/admin-routes.js';
import { createRequireAdmin } from '../middleware/auth.js';
import * as utils from '../lib/episode-utils.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kack-search-test-'));
process.env.ENTITY_REGISTRY_PATH = path.join(tmp, 'decisions.json');
const database = await createDatabase(path.join(tmp, 'episodes.db'));
const { episodes } = createRepositories(database);
const fixtures = [
  ['Kack to the Future', 'Science Fiction', 'Hörerfeedback', 'Dag von SDP', 'Zurück in die Zukunft', 'Zeitreisen und Zeitparadoxien', '10:00'],
  ['Weltraum', 'Astronomie', 'Hörerfragen', 'Dag-Alexis Kopplin (Sänger der Band SDP)', '', 'Sterne und Planeten', '20:00'],
  ['Star Wars', 'Darth Vader', 'Comics', 'Fab (Diplom-Mathematiker)', 'Star Wars', 'Raumschiffe', '30:00'],
  ['Blade Runner', 'Künstliche Intelligenz', 'Science-Fiction', 'Fab (vom Team Kirschwässerle)', 'Blade Runner', 'Roboter und Bewusstsein', '40:00'],
  ['Faszination Kosmos', 'Weltraumkunde', 'Filmproduktion', '', '', 'Galaxien und Himmelskörper', '50:00'],
];
fixtures.forEach(([title, topic, topic2, guest, work, description, duration], index) => {
  database.dbRun('INSERT INTO episodes (guid,title,description,duration,pub_ts,topics_json,guests_json,film_title,chapters_json) VALUES (?,?,?,?,?,?,?,?,?)',
    [`fixture-${index}`, title, description, duration, index + 1, JSON.stringify([topic, topic2]), JSON.stringify(guest ? [guest] : []), work, JSON.stringify([{ time: '00:00:00', title: 'Einführung' }])]);
});
const docs = episodes.searchRows().map(buildSearchDocument);
const indexPath = path.join(tmp, 'index.json');
const source = { id: 'topic-weltraumkunde', name: 'Weltraumkunde', count: 1, examples: [] };
const target = { id: 'topic-astronomie', name: 'Astronomie', count: 1, examples: [] };
const indexData = { schema: SEARCH_SCHEMA, pipeline: SEARCH_PIPELINE, model: 'fixture', digest: 'fixture-v1', dimensions: 3,
  episodes: docs.map((doc) => ({ id: doc.id, hash: doc.hash, vector: doc.id <= 2 ? [1, 0, 0] : [0, 1, 0] })),
  cluster_candidates: [{ id: 'candidate-1', type: 'topic', source, target, similarity: .93, model: 'fixture' },
    { id: 'candidate-work', type: 'work', source: { id: 'work-a', name: 'Film A' }, target: { id: 'work-b', name: 'Film B' }, similarity: .9 }] };
fs.writeFileSync(indexPath, JSON.stringify(indexData));
const embedder = { enabled: true, model: 'fixture', identity: async () => ({ digest: 'fixture-v1' }), query: async () => [1, 0, 0] };
const search = createSearchService({ episodes, indexPath, embedder });
const clusters = createClusterService({ episodes, indexPath });
const controller = createPublicController({ ...utils, episodes, searchService: search });
const adminController = createAdminController({ clusterService: clusters });
const app = express(); app.use(express.json());
app.use('/api', createPublicRoutes({ controller, suggestionLimiter: (_req, _res, next) => next() }));
app.use('/api', createAdminRoutes({ controller: adminController, requireAdmin: createRequireAdmin('fixture-token') }));
const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
const get = async (url) => { const r = await fetch(base + url); return { status: r.status, body: await r.json() }; };
const post = async (url, body, token = 'fixture-token') => {
  const r = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
after(async () => { await new Promise((resolve) => server.close(resolve)); fs.rmSync(tmp, { recursive: true, force: true }); delete process.env.ENTITY_REGISTRY_PATH; });

test('canonical topic counts agree with filters for names, IDs and aliases', async () => {
  const catalog = (await get('/api/topics')).body;
  const topic = catalog.find((x) => x.id === 'community-feedback');
  assert.equal(topic.count, 2);
  for (const value of ['Community-Feedback', 'community-feedback', 'Hörerfragen', 'Hörerfeedback']) {
    const result = await get('/api/episodes?topic=' + encodeURIComponent(value));
    assert.equal(result.status, 200); assert.equal(result.body.total, topic.count, value);
  }
});
test('canonical guest filters include all aliases', async () => {
  for (const guest of ['dag-alexis-kopplin', 'Dag von SDP', 'Dag-Alexis Kopplin']) assert.equal((await search.list({ guest })).total, 2);
});
test('topic normalization joins punctuation/plurals but not related concepts', () => {
  assert.equal(utils.normalizeTopicEntry('Science-Fiction').id, 'science-fiction');
  assert.equal(utils.normalizeTopicEntry('Zeitreise').id, utils.normalizeTopicEntry('Zeitreisen').id);
  assert.notEqual(utils.normalizeTopicEntry('Comics').id, utils.normalizeTopicEntry('Comicverfilmung').id);
  assert.notEqual(utils.normalizeTopicEntry('Darth Vader').id, utils.normalizeTopicEntry('Star Wars').id);
});
test('a first name cannot impersonate a configured guest', () => {
  assert.notEqual(utils.normalizeGuestEntry('Fab (Diplom-Mathematiker)').id, 'team-kirschwaesserle');
  assert.notEqual(utils.normalizeGuestEntry('Sven (Studio Ehre)').id, utils.normalizeGuestEntry('Sven (Duisburg)').id);
  assert.equal(utils.normalizeGuestEntry('Claudiu Mark Draghici Schauspieler, Sprecher und echter Transilvanier').id, 'claudiu-mark-draghici');
});
test('word search supports typos, multiple words, topics, guests and chapters without an encoder', async () => {
  const lexical = createSearchService({ episodes });
  for (const q of ['Bladde Runner', 'künstliches Bewusstsein Roboter', 'Astronomie', 'Dag', 'Einführung']) assert.ok((await lexical.list({ q })).total > 0, q);
  assert.equal((await lexical.list({ q: 'Blade Runner' })).episodes[0].title, 'Blade Runner');
});
test('semantic-only matches enter hybrid results and exact names stay useful', async () => {
  const result = await search.list({ q: 'Zeitsprünge' });
  assert.equal(result.mode, 'hybrid'); assert.deepEqual(new Set(result.episodes.map((x) => x.id)), new Set([1, 2]));
  assert.equal((await search.list({ q: 'Blade Runner' })).episodes[0].title, 'Blade Runner');
});
test('encoder failure falls back to word search', async () => {
  const failing = createSearchService({ episodes, indexPath, embedder: { ...embedder, query: async () => { throw new Error('offline'); } } });
  const result = await failing.list({ q: 'Blade Runner' });
  assert.equal(result.mode, 'lexical'); assert.equal(result.episodes[0].title, 'Blade Runner');
});
test('changed model digest is never silently mixed with old document vectors', async () => {
  let queried = false;
  const mismatch = createSearchService({ episodes, indexPath, embedder: { ...embedder, identity: async () => ({ digest: 'changed' }), query: async () => { queried = true; return [1, 0, 0]; } } });
  assert.equal((await mismatch.list({ q: 'Blade Runner' })).mode, 'lexical'); assert.equal(queried, false);
});
test('unknown IDs, pagination, filters and sort preserve their contract', async () => {
  assert.equal((await get('/api/episodes?limit=0')).status, 400);
  assert.equal((await search.list({ topics: ['unknown'] })).total, 0);
  assert.equal((await search.list({ topics: ['Hörerfragen', 'Astronomie'] })).total, 1);
  assert.equal((await search.list({ hasGuest: false })).total, 1);
  assert.equal((await search.list({ hasFilmTitle: true })).total, 3);
  assert.equal((await search.list({ sort: 'duration', limit: 1 })).episodes[0].title, 'Faszination Kosmos');
  assert.equal((await search.list({ limit: 2, offset: 4 })).episodes.length, 1);
});
test('related episodes exclude the source, do not expose private audio and handle invalid IDs', async () => {
  const result = await get('/api/episodes/1/related');
  assert.equal(result.status, 200); assert.ok(result.body.episodes.length);
  assert.ok(result.body.episodes.every((ep) => ep.id !== 1 && !('audio_url' in ep)));
  assert.equal((await get('/api/episodes/9999/related')).status, 404);
  assert.equal((await get('/api/episodes/not-an-id/related')).status, 400);
});
test('public search does not expose manual fields or private media', async () => {
  const ep = (await get('/api/episodes?limit=1')).body.episodes[0];
  assert.ok(!('audio_url' in ep)); assert.ok(!('manual_topics_json' in ep));
});
test('advertising and repeated external links are not embedded as episode meaning', () => {
  assert.equal(cleanDescription('Filmthema\nLINKTREE\nhttps://example.org\nWERBUNG Schuhverkauf'), 'Filmthema');
  assert.ok(!cleanDescription('Filmthema _____ WERBUNG Rabattcode').includes('Rabattcode'));
  assert.throws(() => normalizeVector([0, 0])); assert.throws(() => normalizeVector([NaN]));
});
test('embedding requests use task prompts, validate responses and time out', async () => {
  let payload;
  const encoder = createEmbeddingService({ baseUrl: 'http://localhost:1234', model: 'fixture', fetchImpl: async (_url, options) => {
    payload = JSON.parse(options.body); return { ok: true, json: async () => ({ embeddings: [[2, 0, 0]] }) };
  } });
  assert.deepEqual(await encoder.query('Zeitsprünge'), [1, 0, 0]); assert.ok(payload.input[0].startsWith('task: search result | query: '));
  const invalid = createEmbeddingService({ baseUrl: 'http://localhost:1234', model: 'fixture', fetchImpl: async () => ({ ok: true, json: async () => ({ embeddings: [[0]] }) }) });
  await assert.rejects(() => invalid.query('x'));
  const timeout = createEmbeddingService({ baseUrl: 'http://localhost:1234', model: 'fixture', timeoutMs: 20,
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))) });
  await assert.rejects(() => timeout.query('x'), { name: 'TimeoutError' });
});
test('remote embedding credentials cover both discovery and encoding, never the request body', async () => {
  const seen = [];
  const encoder = createEmbeddingService({ baseUrl: 'https://encoder.example', model: 'fixture', authorization: 'Basic test-credential',
    fetchImpl: async (url, options) => {
      seen.push({ url, options });
      return { ok: true, json: async () => url.endsWith('/api/tags') ? { models: [{ name: 'fixture', digest: 'v1' }] } : { embeddings: [[1, 0]] } };
    } });
  assert.equal((await encoder.identity()).digest, 'v1');
  await encoder.query('Test');
  assert.equal(seen.length, 2);
  for (const item of seen) { assert.equal(item.options.headers.Authorization, 'Basic test-credential'); assert.ok(!item.options.body?.includes('test-credential')); }
});
test('cluster review is protected, requires reasoning, persists and is reversible without editing raw data', async () => {
  assert.equal((await get('/api/clusters')).status, 401);
  assert.equal(clusters.list().total, 1);
  assert.equal(clusters.review('candidate-1', { action: 'merge' }).status, 400);
  assert.equal(clusters.review('candidate-work', { action: 'merge', note: 'test' }).status, 400);
  const raw = episodes.searchRows().find((ep) => ep.id === 5).topics_json;
  assert.equal((await post('/api/clusters/candidate-1/review', { action: 'merge', note: 'Geprüfte thematische Gleichsetzung für Test.' }, 'wrong-token')).status, 401);
  assert.equal((await post('/api/clusters/candidate-1/review', { action: 'merge', note: 'Geprüfte thematische Gleichsetzung für Test.' })).body.ok, true);
  assert.equal((await search.list({ topics: ['Astronomie'] })).total, 2);
  assert.equal((await search.list({ topics: ['topic-weltraumkunde'] })).total, 2);
  assert.equal(episodes.searchRows().find((ep) => ep.id === 5).topics_json, raw);
  assert.equal(clusters.review('candidate-1', { action: 'merge', note: 'double' }).status, 409);
  assert.equal((await post('/api/clusters/candidate-1/review', { action: 'undo' })).body.ok, true);
  assert.equal((await search.list({ topics: ['Astronomie'] })).total, 1);
  assert.equal(clusters.history().length, 1);
});
test('stale vectors and cluster suggestions are not reused after content changes', async () => {
  database.dbRun('UPDATE episodes SET description = ? WHERE id = 1', ['Neuer Inhalt']);
  const result = await search.list({ q: 'Zeitsprünge' });
  assert.ok(!result.episodes.some((ep) => ep.id === 1));
  assert.equal(clusters.list().total, 0);
});

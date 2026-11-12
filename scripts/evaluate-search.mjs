import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createDatabase } from '../models/database.js';
import { createRepositories } from '../models/repositories.js';
import { createSearchService } from '../services/search-service.js';
import { createEmbeddingService } from '../services/embedding-service.js';

// Hand-labelled development sample, not an independent benchmark or proof of overall accuracy.
const cases = [
  { q: 'Zeitsprünge', expected: ['#020:', '#100:'] },
  { q: 'Wie entstehen Zeichentrickfilme?', expected: ['#369:', '#019:', '#029:'] },
  { q: 'Träume und Wirklichkeit', expected: ['#264:'] },
  { q: 'künstliches Bewusstsein', expected: ['#303:', '#107:', '#096:'] },
  { q: 'griechische Göttersagen', expected: ['#114:', '#115:'] },
  { q: 'Zurück in die Zukunft', expected: ['#100:'] },
  { q: 'Dag von SDP', expected: ['#270:', '#130:', '#131:', '#344:', '#345:', '#164:', '#138:', '#271:'] },
  { q: 'Batman', expected: ['#045:', '#277:', '#122:'] },
  { q: 'Mittelerde und Hobbits', expected: ['#073:', '#074:', '#075:', '#309:'] },
  { q: 'Verschwörungstheorien über flache Erde', expected: ['Premium Classics | Skepschiss: Flat Earth'] },
  { q: 'qzxxvllp nonexistent quarkfoo', expected: [], negative: true },
  { q: 'zzzvxxqpp', expected: [], negative: true },
];
const database = await createDatabase(process.env.DB_FILE || 'episodes.db');
const { episodes } = createRepositories(database);
const lexical = createSearchService({ episodes });
const oldSearch = async (q) => {
  const rows = database.dbAll('SELECT * FROM episodes WHERE title LIKE ? OR description LIKE ? OR format_name LIKE ? OR film_title LIKE ? OR manual_film_title LIKE ?', Array(5).fill(`%${q}%`));
  const score = (ep) => {
    const title = (ep.title || '').toLowerCase(), query = q.toLowerCase();
    return (title === query ? 120 : 0) + (title.startsWith(query) ? 80 : 0) + (title.includes(query) ? 50 : 0)
      + ((ep.description || '').toLowerCase().includes(query) ? 20 : 0) + ((ep.summary || '').toLowerCase().includes(query) ? 10 : 0);
  };
  return { episodes: rows.sort((a, b) => score(b) - score(a) || b.pub_ts - a.pub_ts).slice(0, 5), mode: 'original' };
};
const engines = [
  { name: 'original', list: ({ q }) => oldSearch(q) },
  { name: 'minisearch', list: (options) => lexical.list(options) },
  ...[
    ['embeddinggemma', process.env.GEMMA1_URL || 'http://127.0.0.1:11434', 'data/search-index-gemma1.json'],
    ['embeddinggemma-2', process.env.GEMMA2_URL || 'http://127.0.0.1:11435', 'data/search-index-gemma2.json'],
  ].map(([name, baseUrl, indexPath]) => {
    const service = createSearchService({ episodes, indexPath, embedder: createEmbeddingService({ baseUrl, model: name, timeoutMs: 10000 }) });
    return { name, list: (options) => service.list(options) };
  }),
];
const results = [];
for (const engine of engines) {
  // Warm index parsing and model loading separately from request latency.
  await engine.list({ q: 'Batman', limit: 5 });
  const rows = [];
  for (const item of cases) {
    const start = performance.now();
    const result = await engine.list({ q: item.q, limit: 5 });
    const titles = result.episodes.map((ep) => ep.title);
    const rank = titles.findIndex((title) => item.expected.some((label) => title.startsWith(label))) + 1;
    rows.push({ ...item, titles, rank, mode: result.mode, latency_ms: Math.round((performance.now() - start) * 10) / 10,
      passed: item.negative ? titles.length === 0 : rank > 0 });
  }
  const positives = rows.filter((item) => !item.negative), latencies = rows.map((item) => item.latency_ms).sort((a, b) => a - b);
  const summary = { engine: engine.name, queries: rows.length, positive_queries: positives.length,
    hit_at_1: positives.filter((item) => item.rank === 1).length,
    hit_at_5: positives.filter((item) => item.rank > 0).length,
    mrr_at_5: Math.round(positives.reduce((sum, item) => sum + (item.rank ? 1 / item.rank : 0), 0) / positives.length * 1000) / 1000,
    negatives_correct: rows.filter((item) => item.negative && item.passed).length,
    median_ms: latencies[Math.floor(latencies.length / 2)], p95_ms: latencies[Math.ceil(latencies.length * .95) - 1] };
  results.push({ summary, rows });
  console.log(JSON.stringify(summary));
}
const output = process.env.EVALUATION_OUTPUT || 'data/search-evaluation.json';
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({ kind: 'hand-labelled development sample; not independent', created_at: new Date().toISOString(), results }, null, 2) + '\n');

import fs from 'node:fs';
import { createHash } from 'node:crypto';
import MiniSearch from 'minisearch';
import { buildSearchDocument, cosine, normalizeVector, SEARCH_SCHEMA, SEARCH_PIPELINE } from '../lib/search-documents.js';
import { normalizeGuestEntry, normalizeTopicEntry, normalizeText } from '../lib/episode-utils.js';
import { readEntityRegistry, applyEntityOverride } from '../lib/entity-registry.js';
import { TOPIC_RELATIONS } from '../config/topic-model.js';

const STOP = new Set('der die das den dem des ein eine einer einem einen und oder in im am an auf aus von vom zu zur zum mit für fuer über ueber es ist sind war wie was welche welcher welches folge folgen episode episoden film filme bitte zeig mir ich suche entstehen'.split(' '));
const term = (value) => value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss');
const byDate = (a, b) => (Number(b.episode.pub_ts) || 0) - (Number(a.episode.pub_ts) || 0) || b.id - a.id;
const duration = (value) => String(value || '').split(':').reduce((sum, part) => sum * 60 + (Number(part) || 0), 0);

export function createSearchService({ episodes, embedder, indexPath, minSimilarity, log = () => {} }) {
  let signature, documents = [], index;
  let vectors = new Map(), vectorMeta = null, vectorMtime = null;
  let semanticError = null;
  let verifiedDigest = null, verifiedAt = 0;

  function refresh() {
    const rows = episodes.searchRows();
    const next = createHash('sha256').update(JSON.stringify(rows) + JSON.stringify(readEntityRegistry())).digest('hex');
    if (next !== signature) {
      documents = rows.map(buildSearchDocument);
      index = new MiniSearch({ fields: ['title', 'work', 'format', 'description', 'guests', 'topics', 'chapters'],
        processTerm: (value) => { const t = term(value); return t.length > 1 && !STOP.has(t) ? t : null; },
        searchOptions: { boost: { title: 6, work: 5, guests: 3, topics: 3, chapters: 2 },
          prefix: (value) => value.length >= 3, fuzzy: (value) => value.length >= 5 ? 0.2 : false } });
      index.addAll(documents);
      signature = next;
    }
    if (indexPath) {
      try {
        const mtime = fs.statSync(indexPath).mtimeMs;
        if (mtime !== vectorMtime) {
          const data = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
          if (data.schema !== SEARCH_SCHEMA || data.pipeline !== SEARCH_PIPELINE || !data.digest || !data.model ||
              !Number.isInteger(data.dimensions) || data.dimensions < 1 || !Array.isArray(data.episodes)) throw new Error('Incompatible semantic index');
          if (embedder?.enabled && data.model !== embedder.model && data.model !== `${embedder.model}:latest`) throw new Error('Embedding model does not match index');
          const loaded = new Map(data.episodes.map((item) => {
            if (item.vector?.length !== data.dimensions) throw new Error('Inconsistent vector dimensions');
            return [item.id, { hash: item.hash, vector: normalizeVector(item.vector) }];
          }));
          vectors = loaded; vectorMeta = data; vectorMtime = mtime; verifiedDigest = null;
          semanticError = null;
        }
      } catch (err) {
        vectors = new Map(); vectorMeta = null; vectorMtime = null;
        semanticError = err.code === 'ENOENT' ? 'index_missing' : 'index_invalid';
      }
    }
    return documents;
  }

  function vectorFor(doc) {
    const item = vectors.get(doc.id);
    return item?.hash === doc.hash ? item.vector : null;
  }

  function filterDocuments(options) {
    const guestId = options.guest ? normalizeGuestEntry(options.guest)?.id : null;
    const guestRedirect = options.guest ? applyEntityOverride('guest', { id: options.guest, name: options.guest }).id : null;
    const topicIds = (options.topics || []).map((x) => ({ raw: applyEntityOverride('topic', { id: x, name: x }).id, id: normalizeTopicEntry(x)?.id }));
    return documents.filter((doc) => {
      const ep = doc.episode;
      if (options.guest && !doc.guestIds.includes(guestRedirect) && !doc.guestIds.includes(guestId)) return false;
      if (topicIds.some((x) => !doc.topicIds.includes(x.raw) && !doc.topicIds.includes(x.id))) return false;
      if (options.format && doc.format !== options.format) return false;
      if (options.hasGuest !== undefined && Boolean(doc.guestIds.length) !== options.hasGuest) return false;
      if (options.hasChapters !== undefined && Boolean(ep.chapters?.length) !== options.hasChapters) return false;
      if (options.hasFilmTitle !== undefined && Boolean(doc.work) !== options.hasFilmTitle) return false;
      return true;
    });
  }

  async function list(options = {}) {
    refresh();
    const q = normalizeText(options.q);
    let rows = filterDocuments(options);
    let mode = q ? 'lexical' : 'browse';
    const ranking = new Map();
    if (q) {
      const lexical = index.search(q, { combineWith: 'AND' });
      lexical.forEach((hit, rank) => ranking.set(hit.id, 1 / (10 + rank + 1)));
      if (embedder?.enabled && vectorMeta) {
        try {
          if (verifiedDigest !== vectorMeta.digest || Date.now() - verifiedAt > 60000) {
            const identity = await embedder.identity();
            if (identity.digest !== vectorMeta.digest) throw new Error('Embedding model digest changed; rebuild index');
            verifiedDigest = identity.digest;
            verifiedAt = Date.now();
          }
          const query = await embedder.query(q, vectorMeta.digest);
          if (query.length !== vectorMeta.dimensions) throw new Error('Embedding dimension mismatch');
          const scored = documents.filter((doc) => /[\p{L}\p{N}]{2}/u.test(doc.title))
            .map((doc) => ({ id: doc.id, score: cosine(query, vectorFor(doc)) })).sort((a, b) => b.score - a.score);
          const threshold = Math.max(minSimilarity ?? vectorMeta.retrieval?.min_similarity ?? 0.4,
            (scored[0]?.score || 0) - (vectorMeta.retrieval?.score_window ?? 0.08));
          const semantic = scored.filter((x) => x.score >= threshold).slice(0, 12);
          semantic.forEach((hit, rank) => ranking.set(hit.id, (ranking.get(hit.id) || 0) + 1.2 / (10 + rank + 1)));
          mode = 'hybrid'; semanticError = null;
        } catch (err) {
          if (semanticError !== 'encoder_unavailable') log('search', `Semantic search unavailable: ${err.message}`, null, 'warn');
          semanticError = 'encoder_unavailable';
        }
      }
      // Keep exact named entities ahead of merely related semantic matches.
      for (const doc of documents) {
        if (q.length >= 3 && [doc.title, doc.work, doc.guests].some((value) => term(value).includes(term(q)))) {
          ranking.set(doc.id, (ranking.get(doc.id) || 0) + 0.3);
        }
      }
      rows = rows.filter((doc) => ranking.has(doc.id));
    }
    const sort = options.sort || (q ? 'relevance' : 'pub_date');
    rows.sort(sort === 'duration' ? (a, b) => duration(b.episode.duration) - duration(a.episode.duration) || byDate(a, b)
      : sort === 'relevance' && q ? (a, b) => (ranking.get(b.id) || 0) - (ranking.get(a.id) || 0) || byDate(a, b) : byDate);
    return { total: rows.length, sort, mode, episodes: rows.slice(options.offset || 0, (options.offset || 0) + (options.limit || 24)).map((doc) => doc.episode) };
  }

  function related(id, limit = 4) {
    refresh();
    const source = documents.find((doc) => doc.id === Number(id));
    if (!source) return null;
    const sourceVector = vectorFor(source);
    const relations = [...TOPIC_RELATIONS, ...readEntityRegistry().decisions.filter((x) => x.action === 'related' && !x.undone_at)
      .map((x) => ({ from: x.source.id, to: x.target.id, type: 'related' }))];
    const lexical = new Map(index.search([source.work, source.topics].join(' ')).map((hit) => [hit.id, hit.score]));
    const rows = documents.filter((doc) => doc.id !== source.id && /[\p{L}\p{N}]{2}/u.test(doc.title)).map((doc) => {
      const shared = doc.topicIds.filter((topic) => source.topicIds.includes(topic)).length;
      const sourceIds = [...source.topicIds, ...source.guestIds, source.episode.work_id];
      const targetIds = [...doc.topicIds, ...doc.guestIds, doc.episode.work_id];
      const related = relations.some((r) => sourceIds.includes(r.from) && targetIds.includes(r.to) || sourceIds.includes(r.to) && targetIds.includes(r.from));
      const score = sourceVector && vectorFor(doc) ? cosine(sourceVector, vectorFor(doc)) : 0;
      return { doc, score: score + shared * 0.12 + (related ? 0.25 : 0) + (source.work && source.work === doc.work ? 0.5 : 0) + (lexical.has(doc.id) ? 0.02 : 0) };
    }).filter((x) => x.score >= 0.12).sort((a, b) => b.score - a.score || byDate(a.doc, b.doc));
    return { episode_id: source.id, mode: sourceVector ? 'semantic' : 'topics', episodes: rows.slice(0, limit).map((x) => x.doc.episode) };
  }

  function status() {
    refresh();
    return { lexical: true, semantic_configured: Boolean(embedder?.enabled), indexed: documents.filter((doc) => vectorFor(doc)).length,
      total: documents.length, model: vectorMeta?.model || null, issue: semanticError };
  }
  return { list, related, status, documents: () => { refresh(); return documents; } };
}

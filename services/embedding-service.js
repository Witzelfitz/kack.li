import { normalizeVector } from '../lib/search-documents.js';

export const EMBEDDING_PROMPTS = {
  query: 'task: search result | query: ',
  document: 'title: none | text: ',
  cluster: 'task: clustering | query: ',
};

export function createEmbeddingService({ baseUrl, model, authorization, timeoutMs = 3000, fetchImpl = fetch } = {}) {
  const cache = new Map();
  const pending = new Map();
  const enabled = Boolean(baseUrl && model);
  if (baseUrl && !['http:', 'https:'].includes(new URL(baseUrl).protocol)) throw new Error('Invalid embedding URL');
  async function embed(texts, task = 'document') {
    if (!enabled) throw new Error('Embeddings not configured');
    if (!EMBEDDING_PROMPTS[task]) throw new Error('Unknown embedding task');
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/api/embed`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
      body: JSON.stringify({ model, input: texts.map((text) => EMBEDDING_PROMPTS[task] + text), truncate: true }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`Embedding service HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.embeddings) || data.embeddings.length !== texts.length) throw new Error('Invalid embedding response');
    return data.embeddings.map(normalizeVector);
  }
  async function query(text, version = model) {
    const key = `${version}:${text}`;
    if (cache.has(key)) return cache.get(key);
    if (pending.has(key)) return pending.get(key);
    if (pending.size >= 2) throw new Error('Embedding service busy');
    const job = embed([text], 'query').then(([vector]) => {
      cache.set(key, vector);
      if (cache.size > 200) cache.delete(cache.keys().next().value);
      return vector;
    }).finally(() => pending.delete(key));
    pending.set(key, job);
    return job;
  }
  async function identity() {
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/api/tags`, {
      headers: authorization ? { Authorization: authorization } : {}, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`Embedding model discovery HTTP ${response.status}`);
    const data = await response.json();
    const item = data.models?.find((x) => x.name === model || x.name === `${model}:latest`);
    if (!item?.digest) throw new Error(`Embedding model unavailable: ${model}`);
    return { model: item.name, digest: item.digest };
  }
  return { enabled, model, embed, query, identity };
}

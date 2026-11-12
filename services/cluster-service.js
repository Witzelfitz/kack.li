import fs from 'node:fs';
import { readEntityRegistry, writeEntityRegistry, applyEntityOverride } from '../lib/entity-registry.js';
import { buildSearchDocument, SEARCH_SCHEMA, SEARCH_PIPELINE } from '../lib/search-documents.js';

export function createClusterService({ episodes, indexPath }) {
  function candidates() {
    let data;
    try { data = JSON.parse(fs.readFileSync(indexPath, 'utf8')); }
    catch (err) { if (err.code === 'ENOENT') return []; throw err; }
    if (data.schema !== SEARCH_SCHEMA || data.pipeline !== SEARCH_PIPELINE) throw new Error('Rebuild incompatible cluster index');
    // A proposal from an earlier data snapshot must not silently become a new decision.
    const documents = episodes.searchRows().map(buildSearchDocument);
    const hashes = new Map(documents.map((doc) => [doc.id, doc.hash]));
    const fresh = data.episodes.length === documents.length && data.episodes.every((item) => hashes.get(item.id) === item.hash);
    if (!fresh) return [];
    return (data.cluster_candidates || []).filter((item) => ['topic', 'guest', 'work'].includes(item.type));
  }
  function history() { return readEntityRegistry().decisions; }
  function list({ type = 'topic', limit = 50 } = {}) {
    const decisions = history();
    const reviewed = new Set(decisions.filter((x) => !x.undone_at).map((x) => x.id));
    const all = candidates().filter((item) => item.type === type && !reviewed.has(item.id)
      && applyEntityOverride(type, item.source).id === item.source.id
      && applyEntityOverride(type, item.target).id === item.target.id);
    return { type, total: all.length, candidates: all.slice(0, limit), automatic_merges: false };
  }
  function review(id, { action, note = '' }) {
    if (!['merge', 'related', 'reject', 'undo'].includes(action)) return { status: 400, error: 'Erlaubt: merge, related, reject, undo.' };
    if (typeof note !== 'string' || note.length > 500) return { status: 400, error: 'Notiz maximal 500 Zeichen.' };
    const data = structuredClone(readEntityRegistry());
    const previous = data.decisions.find((item) => item.id === id && !item.undone_at);
    if (action === 'undo') {
      if (!previous) return { status: 404, error: 'Entscheidung nicht gefunden.' };
      previous.undone_at = new Date().toISOString();
      writeEntityRegistry(data);
      return { ok: true, decision: previous };
    }
    if (previous) return { status: 409, error: 'Bereits geprüft.' };
    const item = candidates().find((candidate) => candidate.id === id);
    if (!item) return { status: 409, error: 'Vorschlag fehlt oder ist veraltet. Index neu erstellen.' };
    if (action === 'merge' && (item.type === 'work' || item.merge_allowed === false)) return { status: 400, error: 'Unterschiedliche Werke, Teile und Nummern nur als verwandt markieren, nicht gleichsetzen.' };
    if (action === 'merge' && !note.trim()) return { status: 400, error: 'Zusammenführung bitte kurz begründen.' };
    if (applyEntityOverride(item.type, item.source).id !== item.source.id || applyEntityOverride(item.type, item.target).id !== item.target.id) {
      return { status: 409, error: 'Zuordnung wurde inzwischen geändert. Index neu erstellen.' };
    }
    const decision = { id, type: item.type, source: item.source, target: item.target,
      action, note: note.trim(), reviewed_by: 'admin', reviewed_at: new Date().toISOString(), model: item.model };
    data.decisions.push(decision);
    writeEntityRegistry(data);
    return { ok: true, decision };
  }
  return { list, review, history };
}

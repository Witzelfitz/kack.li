import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultFile = fileURLToPath(new URL('../data/entity-decisions.json', import.meta.url));
let cachedFile, cachedAt = 0, cached;
export function readEntityRegistry() {
  const file = process.env.ENTITY_REGISTRY_PATH || defaultFile;
  if (file === cachedFile && Date.now() - cachedAt < 200) return cached;
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (err) { if (err.code !== 'ENOENT') throw err; data = { schema: 1, decisions: [] }; }
  if (data.schema !== 1 || !Array.isArray(data.decisions)) throw new Error('Invalid entity decision registry');
  cached = data; cachedFile = file; cachedAt = Date.now();
  return data;
}

export function applyEntityOverride(type, entity) {
  const decisions = readEntityRegistry().decisions;
  let result = entity;
  const seen = new Set();
  while (!seen.has(result.id)) {
    seen.add(result.id);
    const decision = [...decisions].reverse().find((x) => x.type === type && x.source.id === result.id && x.action === 'merge' && !x.undone_at);
    if (!decision) break;
    result = { ...result, id: decision.target.id, name: decision.target.name, matched: true,
      aliases: [...new Set([...(result.aliases || []), entity.name])] };
  }
  return result;
}

export function writeEntityRegistry(data) {
  const file = process.env.ENTITY_REGISTRY_PATH || defaultFile;
  // Validate the existing file before replacing it; never erase a corrupt registry silently.
  readEntityRegistry();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temp, file);
  cachedFile = file; cached = data; cachedAt = Date.now();
}

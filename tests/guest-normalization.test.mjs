import assert from 'node:assert/strict';
import { normalizeGuestEntry, normalizeGuestList } from '../lib/episode-utils.js';

const cases = [
  {
    input: 'Dag-Alexis Kopplin (Sänger der Band SDP)',
    expectedId: 'dag-alexis-kopplin',
    expectedName: 'Dag-Alexis Kopplin',
  },
  {
    input: 'Dag-Alexis Kopplin, Sänger der Band SDP',
    expectedId: 'dag-alexis-kopplin',
    expectedName: 'Dag-Alexis Kopplin',
  },
  {
    input: 'Tante Julia, Video-Editorin',
    expectedId: 'julia',
    expectedName: 'Julia',
  },
  {
    input: 'Delio (Viral-Video)',
    expectedId: 'delio-malaer',
    expectedName: 'Delio Malär',
  },
  {
    input: 'Unbekannter Gast, Spezialist',
    expectedId: 'guest-unbekannter-gast',
    expectedName: 'Unbekannter Gast',
  },
];

for (const test of cases) {
  const normalized = normalizeGuestEntry(test.input);
  assert.equal(normalized.id, test.expectedId, `ID mismatch for ${test.input}`);
  assert.equal(normalized.name, test.expectedName, `Name mismatch for ${test.input}`);
}

const deduped = normalizeGuestList([
  'Dag-Alexis Kopplin (Sänger der Band SDP)',
  'Dag-Alexis Kopplin, Sänger der Band SDP',
  'Dag von SDP',
]);
assert.deepEqual(deduped, ['Dag-Alexis Kopplin']);

console.log(`OK: ${cases.length + 1} Gäste-Normalisierungstests bestanden.`);

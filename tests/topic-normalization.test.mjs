import assert from 'node:assert/strict';
import { normalizeTopicEntry, normalizeTopicList } from '../lib/episode-utils.js';

const cases = [
  { input: 'Hörermails', expectedId: 'community-feedback', expectedName: 'Community-Feedback' },
  { input: 'Hörerfragen', expectedId: 'community-feedback', expectedName: 'Community-Feedback' },
  { input: 'Premium Kanal', expectedId: 'premium-kanal', expectedName: 'Premium-Kanal' },
  { input: 'Premium-Kanal', expectedId: 'premium-kanal', expectedName: 'Premium-Kanal' },
  { input: 'Film Analyse', expectedId: 'filmanalyse', expectedName: 'Filmanalyse' },
  { input: 'Filmanalyse', expectedId: 'filmanalyse', expectedName: 'Filmanalyse' },
  { input: 'Unbekanntes Spezialthema', expectedId: 'topic-unbekanntes-spezialthema', expectedName: 'Unbekanntes Spezialthema' },
];

for (const test of cases) {
  const normalized = normalizeTopicEntry(test.input);
  assert.equal(normalized.id, test.expectedId, `ID mismatch for ${test.input}`);
  assert.equal(normalized.name, test.expectedName, `Name mismatch for ${test.input}`);
}

const deduped = normalizeTopicList(['Hörermails', 'Hörerfragen', 'Hörerfeedback']);
assert.deepEqual(deduped, ['Community-Feedback']);

console.log(`OK: ${cases.length + 1} Themen-Normalisierungstests bestanden.`);

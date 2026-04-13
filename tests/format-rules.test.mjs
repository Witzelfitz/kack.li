import assert from 'node:assert/strict';
import { detectEpisodeFormat } from '../lib/episode-utils.js';

const cases = [
  { title: '#341: SciFiTech - SETI & Astrobiologie', expected: 'SciFiTech' },
  { title: 'HOSE RUNTER 11 - Jubiläumsparty und 1 Jahr Trennung', expected: 'HOSE RUNTER' },
  { title: '#349: Trek Talk Takeover - Leben mit Star Trek', expected: 'Trek Talk Takeover' },
  { title: 'BONUS: Fab hat ein Buch geschrieben - Konvergenz', expected: 'Bonus' },
  { title: 'Skepshiz: Homöopathie', expected: 'Skepshiz' },
  { title: 'Meta: Werbung', expected: 'Meta' },
  { title: 'Trailer: Kack & Sachgeschichten', expected: 'Trailer' },
  { title: 'Corona Talk: Uns hat\'s erwischt!', expected: 'Sonderfolge' },
  { title: '#348: Burn After Reading - Gesetz der Dummheit', expected: 'Hauptfolge' },
];

for (const test of cases) {
  const actual = detectEpisodeFormat(test.title);
  assert.equal(actual, test.expected, `Format mismatch for "${test.title}"`);
}

console.log(`OK: ${cases.length} Format-Regeltests bestanden.`);

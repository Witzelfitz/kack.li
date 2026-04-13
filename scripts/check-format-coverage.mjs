import fetch from 'node-fetch';
import xml2js from 'xml2js';
import { detectEpisodeFormat } from '../lib/episode-utils.js';

const RSS_URL = 'https://brainfart.podcaster.de/kack-sachgeschichten.rss';
const TARGET_COVERAGE = 95;

const res = await fetch(RSS_URL);
if (!res.ok) {
  throw new Error(`Feed konnte nicht geladen werden: HTTP ${res.status}`);
}

const xml = await res.text();
const parsed = await xml2js.parseStringPromise(xml, { explicitArray: false });
const items = Array.isArray(parsed.rss.channel.item) ? parsed.rss.channel.item : [parsed.rss.channel.item];

const counts = {};
let matched = 0;

for (const item of items) {
  const format = detectEpisodeFormat(item.title || '');
  if (!format) continue;
  matched++;
  counts[format] = (counts[format] || 0) + 1;
}

const total = items.length;
const coverage = total ? (matched / total) * 100 : 0;
const rounded = Math.round(coverage * 100) / 100;

console.log(
  JSON.stringify(
    {
      total,
      matched,
      coverage: rounded,
      target: TARGET_COVERAGE,
      formats: Object.entries(counts)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'de')),
    },
    null,
    2
  )
);

if (coverage < TARGET_COVERAGE) {
  console.error(`Coverage zu niedrig: ${rounded}% < ${TARGET_COVERAGE}%`);
  process.exit(1);
}

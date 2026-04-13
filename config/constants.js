export const RSS_URL = 'https://brainfart.podcaster.de/kack-sachgeschichten.rss';
export const PARSE_VERSION = 2;

export const FORMAT_DEFINITIONS = [
  { name: 'SciFiTech', pattern: /(?:^|#\d+:\s*)SciFiTech\b/i },
  { name: 'Shitmenge', pattern: /(?:^|#\d+:\s*)Shitmenge\b/i },
  { name: 'HOSE RUNTER', pattern: /^HOSE RUNTER\b/i },
  { name: 'Halloween', pattern: /(?:^|#\d+:\s*)Halloween\b/i },
  { name: 'Jahresrückblick', pattern: /(?:^|#\d+:\s*)Jahresrückblick\b/i },
  { name: 'Premium Classics', pattern: /^Premium Classics\b/i },
  { name: 'Geburtstags-Show', pattern: /(?:^|#\d+:\s*)Geburtstags-Show\b/i },
  { name: 'Filmschissenschaft', pattern: /(?:^|#\d+:\s*)Filmschissenschaft\b/i },
  { name: 'Skepschiz', pattern: /^Skepschiz\b/i },
  { name: 'Schrott und die Welt', pattern: /^Schrott und die Welt\b/i },
];

export const PUBLIC_CORS_PATTERNS = [
  /^\/api\/episodes$/,
  /^\/api\/episodes\/\d+$/,
  /^\/api\/guests$/,
  /^\/api\/formats$/,
  /^\/api\/topics$/,
  /^\/api\/status$/,
];

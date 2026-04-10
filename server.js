#!/usr/bin/env node
import 'dotenv/config';
import express        from 'express';
import fetch          from 'node-fetch';
import xml2js         from 'xml2js';
import path           from 'path';
import fs             from 'fs';
import initSqlJs      from 'sql.js';
import OpenAI         from 'openai';
import cron           from 'node-cron';
import rateLimit      from 'express-rate-limit';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app     = express();
const PORT    = process.env.PORT || 3000;
const RSS_URL = 'https://brainfart.podcaster.de/kack-sachgeschichten.rss';
const DB_FILE = path.join(__dirname, 'episodes.db');
const PARSE_VERSION = 2;
const FORMAT_DEFINITIONS = [
  { name: 'SciFiTech',         pattern: /(?:^|#\d+:\s*)SciFiTech\b/i },
  { name: 'Shitmenge',         pattern: /(?:^|#\d+:\s*)Shitmenge\b/i },
  { name: 'HOSE RUNTER',       pattern: /^HOSE RUNTER\b/i },
  { name: 'Halloween',         pattern: /(?:^|#\d+:\s*)Halloween\b/i },
  { name: 'Jahresrückblick',   pattern: /(?:^|#\d+:\s*)Jahresrückblick\b/i },
  { name: 'Premium Classics',  pattern: /^Premium Classics\b/i },
  { name: 'Geburtstags-Show',  pattern: /(?:^|#\d+:\s*)Geburtstags-Show\b/i },
  { name: 'Filmschissenschaft', pattern: /(?:^|#\d+:\s*)Filmschissenschaft\b/i },
  { name: 'Skepschiz',         pattern: /^Skepschiz\b/i },
  { name: 'Schrott und die Welt', pattern: /^Schrott und die Welt\b/i },
];
const PUBLIC_CORS_PATTERNS = [
  /^\/api\/episodes$/,
  /^\/api\/episodes\/\d+$/,
  /^\/api\/guests$/,
  /^\/api\/formats$/,
  /^\/api\/topics$/,
  /^\/api\/status$/,
];

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OPEN_API_KEY;
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());

app.use((req, res, next) => {
  const allowPublicCors =
    !req.headers.authorization &&
    ['GET', 'OPTIONS'].includes(req.method) &&
    PUBLIC_CORS_PATTERNS.some((pattern) => pattern.test(req.path));

  if (allowPublicCors) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Anfragen, bitte später erneut versuchen.' },
});

const suggestionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Vorschläge in kurzer Zeit, bitte später erneut versuchen.' },
});

function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ── sql.js DB wrapper ─────────────────────────────────────────────────────────
let db;

async function initDb() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_FILE)) {
    const buf = fs.readFileSync(DB_FILE);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }
  db.run(`
    CREATE TABLE IF NOT EXISTS episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guid TEXT UNIQUE NOT NULL,
      title TEXT, pub_date TEXT, duration TEXT,
      description TEXT, summary TEXT, audio_url TEXT,
      episode_num INTEGER, image_url TEXT, link TEXT
    );
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS logs (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      ts      TEXT    NOT NULL,
      level   TEXT    NOT NULL DEFAULT 'info',
      event   TEXT    NOT NULL,
      message TEXT,
      meta_json TEXT
    );
    CREATE TABLE IF NOT EXISTS episode_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_id INTEGER NOT NULL,
      suggestion_type TEXT NOT NULL,
      value TEXT NOT NULL,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      reviewed_at TEXT,
      review_note TEXT
    );
  `);
  for (const col of [
    'pub_ts INTEGER',
    'chapters_json TEXT',
    'guests_json TEXT',
    'topics_json TEXT',
    'film_title TEXT',
    'manual_film_title TEXT',
    'format_name TEXT',
    'manual_guests_json TEXT',
    'manual_topics_json TEXT',
    'parsed_at TEXT',
    'parse_version INTEGER',
  ]) {
    try { db.run(`ALTER TABLE episodes ADD COLUMN ${col}`); } catch {}
  }
  const noPubTs = dbAll('SELECT id, pub_date FROM episodes WHERE pub_ts IS NULL');
  for (const row of noPubTs) {
    const ts = row.pub_date ? Math.floor(new Date(row.pub_date).getTime() / 1000) : 0;
    dbRun('UPDATE episodes SET pub_ts = ? WHERE id = ?', [isNaN(ts) ? 0 : ts, row.id]);
  }
  const formatRows = dbAll('SELECT id, title, format_name FROM episodes');
  for (const row of formatRows) {
    const formatName = detectEpisodeFormat(row.title);
    if ((row.format_name || null) === formatName) continue;
    dbRun('UPDATE episodes SET format_name = ? WHERE id = ?', [formatName, row.id]);
  }
  saveDb();
}

function saveDb() {
  fs.writeFileSync(DB_FILE, Buffer.from(db.export()));
}

function dbAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function dbGet(sql, params = []) { return dbAll(sql, params)[0] || null; }
function dbRun(sql, params = []) { db.run(sql, params); }
function tryJson(str) {
  if (!str) return [];
  try { const v = JSON.parse(str); return Array.isArray(v) ? v : []; } catch { return []; }
}

function tryJsonObject(str) {
  if (!str) return {};
  try {
    const value = JSON.parse(str);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function normalizeText(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function detectEpisodeFormat(title) {
  const value = String(title || '').trim();
  if (!value) return null;
  for (const def of FORMAT_DEFINITIONS) {
    if (def.pattern.test(value)) return def.name;
  }
  return null;
}

function cleanEpisodeTitle(title) {
  return normalizeText(
    String(title || '')
      .replace(/^#\d+\s*:\s*/i, '')
      .replace(/^BONUS\s*:\s*/i, '')
      .replace(/\s+\|\s+feat\..*$/i, '')
  );
}

function normalizeFilmTitle(value) {
  const title = normalizeText(value);
  if (!title) return null;
  if (/^(null|none|n\/a|kein(?:e|er)?|unklar|unknown)$/i.test(title)) return null;
  return title;
}

function uniqueStrings(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const text = normalizeText(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function mergeStringArrays(...values) {
  return uniqueStrings(values.flat());
}

function stringsInclude(values, target) {
  const normalizedTarget = normalizeText(target).toLowerCase();
  if (!normalizedTarget) return false;
  return values.some((value) => normalizeText(value).toLowerCase() === normalizedTarget);
}

function getMergedGuests(ep) {
  return mergeStringArrays(tryJson(ep?.guests_json), tryJson(ep?.manual_guests_json));
}

function getMergedTopics(ep) {
  return mergeStringArrays(tryJson(ep?.topics_json), tryJson(ep?.manual_topics_json));
}

function getEffectiveFilmTitle(ep) {
  return normalizeFilmTitle(ep?.manual_film_title) || normalizeFilmTitle(ep?.film_title);
}

function mergeEpisodeCommunityData(ep) {
  if (!ep) return null;
  return {
    ...ep,
    format_name: ep.format_name || detectEpisodeFormat(ep.title),
    film_title: getEffectiveFilmTitle(ep),
    guests_json: JSON.stringify(getMergedGuests(ep)),
    topics_json: JSON.stringify(getMergedTopics(ep)),
  };
}

function normalizeChapters(values) {
  if (!Array.isArray(values)) return [];
  const out = [];
  for (const chapter of values) {
    if (!chapter || typeof chapter !== 'object') continue;
    const time = normalizeText(chapter.time);
    const title = normalizeText(chapter.title);
    if (!time || !title) continue;
    out.push({ time, title });
  }
  return out;
}

function getEpisodesNeedingParse(force = false) {
  return force
    ? dbAll('SELECT id FROM episodes ORDER BY pub_ts ASC')
    : dbAll('SELECT id FROM episodes WHERE COALESCE(parse_version, 0) < ? ORDER BY pub_ts ASC', [PARSE_VERSION]);
}

function sanitizeHttpUrl(value, base = null) {
  if (!value) return '';
  try {
    const url = base ? new URL(String(value).trim(), base) : new URL(String(value).trim());
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function serializeEpisode(ep) {
  if (!ep) return null;
  const merged = mergeEpisodeCommunityData(ep);
  const { manual_film_title, manual_guests_json, manual_topics_json, ...publicEpisode } = merged;
  return {
    ...publicEpisode,
    audio_url: sanitizeHttpUrl(publicEpisode.audio_url, RSS_URL),
    image_url: sanitizeHttpUrl(publicEpisode.image_url, RSS_URL),
    link: sanitizeHttpUrl(publicEpisode.link, RSS_URL),
  };
}

// ── Logging ───────────────────────────────────────────────────────────────────
function log(event, message, meta = null, level = 'info') {
  const ts  = new Date().toISOString();
  const out = `[${ts}] [${event}] ${message}`;
  level === 'error' ? console.error(out) : console.log(out);
  if (!db) return;
  dbRun(
    'INSERT INTO logs (ts, level, event, message, meta_json) VALUES (?,?,?,?,?)',
    [ts, level, event, message, meta ? JSON.stringify(meta) : null]
  );
  // Trim to last 2000 entries to prevent unbounded growth
  dbRun('DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT 2000)');
}

// ── RSS Sync ──────────────────────────────────────────────────────────────────
function stripHtml(str) {
  return (str || '').replace(/<[^>]*>/g, '')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#[0-9]+;/g,'').trim();
}

async function syncFeed() {
  log('sync', 'RSS-Feed wird abgerufen…');
  const res = await fetch(RSS_URL, { headers: { 'User-Agent': 'KuS-EpisodenApp/1.0' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const xml = await res.text();
  const parsed = await xml2js.parseStringPromise(xml, { explicitArray: false });
  const channel = parsed.rss.channel;
  const items = Array.isArray(channel.item) ? channel.item : [channel.item];

  let newCount = 0;
  for (const item of items) {
    const pubDate = item.pubDate || '';
    const pubTs = pubDate ? Math.floor(new Date(pubDate).getTime() / 1000) : 0;
    const title = item.title || '';
    const formatName = detectEpisodeFormat(title);
    const before = dbGet('SELECT id FROM episodes WHERE guid = ?',
      [String(item.guid?._ || item.guid || item.link || title || '')]);
    dbRun(`INSERT INTO episodes (guid,title,pub_date,duration,description,summary,audio_url,episode_num,image_url,link,pub_ts,format_name)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(guid) DO UPDATE SET
        title=excluded.title,pub_date=excluded.pub_date,pub_ts=excluded.pub_ts,duration=excluded.duration,
        description=excluded.description,summary=excluded.summary,audio_url=excluded.audio_url,
        episode_num=excluded.episode_num,image_url=excluded.image_url,link=excluded.link,format_name=excluded.format_name`,
      [String(item.guid?._ || item.guid || item.link || title || ''),
       title, pubDate, item['itunes:duration'] || '',
       stripHtml(item.description || ''),
       stripHtml(item['itunes:summary'] || item.description || ''),
       sanitizeHttpUrl(item.enclosure?.$.url, RSS_URL),
       parseInt(item['itunes:episode']) || null,
       sanitizeHttpUrl(item['itunes:image']?.$.href || channel['itunes:image']?.$.href, RSS_URL),
       sanitizeHttpUrl(item.link, RSS_URL), isNaN(pubTs) ? 0 : pubTs, formatName]);
    if (!before) newCount++;
  }
  const now = new Date().toISOString();
  dbRun(`INSERT INTO meta VALUES ('last_sync',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [now]);
  log('sync', `Abgeschlossen: ${items.length} Episoden, ${newCount} neu`, { total: items.length, new: newCount });
  saveDb();
  return { count: items.length, new: newCount, synced_at: now };
}

// ── OpenAI Parsing ────────────────────────────────────────────────────────────
const TITLE_PARSE_PROMPT = `Du ordnest Episoden des deutschen Podcasts "Kack & Sachgeschichten" dem zentralen Bezugswerk zu.
Die Episodentitel können direkte Werktitel, Wortspiele, eingedeutschte Varianten oder offensichtliche Anspielungen sein.
Antworte NUR mit validem JSON:

{
  "film_title": "kanonischer Titel oder null"
}

Regeln:
- Gib den kanonischen Titel des zentralen Films, der Serie, des Spiels oder der Franchise zurück, wenn die Folge klar diesem Werk gewidmet ist.
- Das gilt auch bei Wortspielen und Abwandlungen, z.B. "Der Top Gun Afterburner" → "Top Gun", "Der Mann in der scheissernen Maske" → "The Mask", "Die Shining Erscheinung" → "The Shining".
- Direkte Titel sollen ebenfalls erkannt werden, z.B. "Ghostbusters", "Harry Potter", "Black Panther", "Get Out", "Burn After Reading".
- Wenn die Folge mehrere Werke gleichwertig behandelt oder kein einzelner Titel klar im Mittelpunkt steht, gib null zurück.
- Ignoriere Episodennummern, "BONUS", "feat."-Zusätze und ähnliche Metadaten.
- Gib nur den Titel zurück, keine Erklärung.`;

const DETAILS_PARSE_PROMPT = `Du analysierst Beschreibungen des deutschen Podcasts "Kack & Sachgeschichten".
Extrahiere die folgenden Felder und antworte NUR mit validem JSON:

{
  "chapters": [ { "time": "HH:MM:SS", "title": "Kapitelname" } ],
  "guests":   [ "Name (ggf. mit Kontext)" ],
  "topics":   [ "Thema 1", "Thema 2" ]
}

Regeln:
- chapters: Nur bei expliziten Zeitstempeln (HH:MM:SS oder MM:SS), exakt übernehmen.
- guests: Nur echte Gäste, NICHT die Hosts Richard und Fred.
- guests: Zusätze wie Funktion, Podcast oder Künstlername dürfen erhalten bleiben, wenn sie im Text stehen.
- topics: 3–7 prägnante Stichworte zu den Hauptthemen.
- Leeres Array [] wenn nichts vorhanden.`;

async function runJsonParse(systemPrompt, input) {
  if (!openai) throw new Error('OPENAI_API_KEY nicht gesetzt');
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: input },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
  });
  return tryJsonObject(completion.choices[0]?.message?.content);
}

async function extractFilmTitle(ep) {
  const input = [
    `Originaler Episodentitel: ${normalizeText(ep.title) || '(leer)'}`,
    `Bereinigter Episodentitel: ${cleanEpisodeTitle(ep.title) || '(leer)'}`,
    '',
    'Beschreibung:',
    ep.description || ep.summary || '(keine)',
  ].join('\n');
  const result = await runJsonParse(TITLE_PARSE_PROMPT, input);
  return normalizeFilmTitle(result.film_title);
}

async function extractEpisodeDetails(ep) {
  const input = `Titel: ${ep.title}\n\nBeschreibung:\n${ep.description || ep.summary || '(keine)'}`;
  const result = await runJsonParse(DETAILS_PARSE_PROMPT, input);
  return {
    chapters: normalizeChapters(result.chapters),
    guests: uniqueStrings(result.guests),
    topics: uniqueStrings(result.topics),
  };
}

async function parseEpisode(ep) {
  const film_title = await extractFilmTitle(ep);
  const details = await extractEpisodeDetails(ep);
  return {
    film_title,
    chapters: details.chapters,
    guests: details.guests,
    topics: details.topics,
  };
}

function saveFilmTitle(id, filmTitle) {
  dbRun('UPDATE episodes SET film_title = ? WHERE id = ?', [filmTitle, id]);
  saveDb();
}

function saveParsed(id, data) {
  dbRun(
    `UPDATE episodes SET film_title=?, chapters_json=?, guests_json=?, topics_json=?, parsed_at=?, parse_version=? WHERE id=?`,
    [data.film_title, JSON.stringify(data.chapters), JSON.stringify(data.guests),
     JSON.stringify(data.topics), new Date().toISOString(), PARSE_VERSION, id]
  );
  saveDb();
}

// ── Nightly Cron ──────────────────────────────────────────────────────────────
cron.schedule('0 3 * * *', async () => {
  log('cron', 'Nachtlauf gestartet');
  try {
    const result = await syncFeed();
    if (openai) {
      const unparsed = getEpisodesNeedingParse();
      log('cron', `${unparsed.length} Episoden benötigen Parsing`, { count: unparsed.length, parse_version: PARSE_VERSION, new: result.new });
      let done = 0, errors = 0;
      for (const { id } of unparsed) {
        const ep = dbGet('SELECT * FROM episodes WHERE id = ?', [id]);
        try {
          const data = await parseEpisode(ep);
          saveParsed(id, data);
          done++;
          log('cron', `Geparst: ${ep.title?.slice(0, 60)}`, { episode_id: id, film_title: data.film_title });
        } catch (err) {
          errors++;
          log('cron', `Parse-Fehler Episode #${id}: ${err.message}`, { episode_id: id }, 'error');
        }
        await new Promise(r => setTimeout(r, 400));
      }
      log('cron', `Nachtlauf abgeschlossen: ${done} OK, ${errors} Fehler`, { done, errors, parse_version: PARSE_VERSION });
    } else {
      log('cron', 'Kein OpenAI-Key – Parsing übersprungen', { new: result.new, parse_version: PARSE_VERSION });
    }
  } catch (err) {
    log('cron', `Fehler: ${err.message}`, null, 'error');
  }
  saveDb();
});

// ── Public API ────────────────────────────────────────────────────────────────
app.use('/api', publicLimiter);
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/episodes', (req, res) => {
  const { q, guest, topic, format, limit = 24, offset = 0 } = req.query;
  const lim = Math.min(parseInt(limit) || 24, 100);
  const off = parseInt(offset) || 0;

  let where = '1=1', params = [];
  if (q?.trim()) {
    where += ' AND (title LIKE ? OR description LIKE ? OR format_name LIKE ? OR film_title LIKE ? OR manual_film_title LIKE ?)';
    const t = `%${q.trim()}%`;
    params.push(t, t, t, t, t);
  }
  if (guest?.trim()) {
    where += ' AND (guests_json LIKE ? OR manual_guests_json LIKE ?)';
    params.push(`%${guest.trim()}%`, `%${guest.trim()}%`);
  }
  if (topic?.trim()) {
    where += ' AND (topics_json LIKE ? OR manual_topics_json LIKE ?)';
    params.push(`%${topic.trim()}%`, `%${topic.trim()}%`);
  }
  if (format?.trim()) {
    where += ' AND format_name = ?';
    params.push(format.trim());
  }

  const total    = dbGet(`SELECT COUNT(*) as c FROM episodes WHERE ${where}`, params)?.c || 0;
  const episodes = dbAll(`SELECT * FROM episodes WHERE ${where} ORDER BY pub_ts DESC LIMIT ? OFFSET ?`,
    [...params, lim, off]).map(serializeEpisode);
  res.json({ total, limit: lim, offset: off, episodes });
});

app.get('/api/episodes/:id', (req, res) => {
  const ep = serializeEpisode(dbGet('SELECT * FROM episodes WHERE id = ?', [req.params.id]));
  if (!ep) return res.status(404).json({ error: 'Nicht gefunden' });
  res.json(ep);
});

app.get('/api/guests', (req, res) => {
  const rows = dbAll('SELECT guests_json, manual_guests_json FROM episodes');
  const counts = {};
  for (const row of rows) {
    for (const g of mergeStringArrays(tryJson(row.guests_json), tryJson(row.manual_guests_json))) {
      counts[g] = (counts[g] || 0) + 1;
    }
  }
  res.json(Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count));
});

app.get('/api/formats', (req, res) => {
  const rows = dbAll('SELECT format_name FROM episodes WHERE format_name IS NOT NULL AND format_name != ?', ['']);
  const counts = {};
  for (const row of rows) {
    const name = normalizeText(row.format_name);
    if (!name) continue;
    counts[name] = (counts[name] || 0) + 1;
  }
  res.json(Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'de')));
});

app.get('/api/topics', (req, res) => {
  const rows = dbAll('SELECT topics_json, manual_topics_json FROM episodes');
  const counts = {};
  for (const row of rows) {
    for (const t of mergeStringArrays(tryJson(row.topics_json), tryJson(row.manual_topics_json))) {
      counts[t] = (counts[t] || 0) + 1;
    }
  }
  res.json(Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count));
});

app.get('/api/status', (req, res) => {
  const total  = dbGet('SELECT COUNT(*) as c FROM episodes')?.c || 0;
  const parsed = dbGet('SELECT COUNT(*) as c FROM episodes WHERE COALESCE(parse_version, 0) >= ?', [PARSE_VERSION])?.c || 0;
  res.json({
    episodes:  total,
    parsed,
    last_sync: dbGet("SELECT value FROM meta WHERE key='last_sync'")?.value || null,
    openai:    !!openai,
    parse_version: PARSE_VERSION,
  });
});

app.post('/api/episodes/:id/suggestions', suggestionLimiter, (req, res) => {
  const episodeId = parseInt(req.params.id, 10);
  const suggestionType = normalizeText(req.body?.type).toLowerCase();
  const value = normalizeText(req.body?.value);
  const note = String(req.body?.note || '').trim();

  if (!Number.isInteger(episodeId) || episodeId <= 0) {
    return res.status(400).json({ error: 'Ungültige Episode.' });
  }
  if (!['guest', 'topic', 'film'].includes(suggestionType)) {
    return res.status(400).json({ error: 'Ungültiger Vorschlagstyp. Erlaubt sind guest, topic oder film.' });
  }
  if (value.length < 2 || value.length > 120) {
    return res.status(400).json({ error: 'Der Vorschlag muss zwischen 2 und 120 Zeichen lang sein.' });
  }
  if (note.length > 500) {
    return res.status(400).json({ error: 'Die Notiz darf maximal 500 Zeichen lang sein.' });
  }

  const ep = dbGet(
    `SELECT id, title, film_title, manual_film_title,
            guests_json, manual_guests_json, topics_json, manual_topics_json
     FROM episodes WHERE id = ?`,
    [episodeId]
  );
  if (!ep) return res.status(404).json({ error: 'Episode nicht gefunden.' });

  if (suggestionType === 'film') {
    if (normalizeText(getEffectiveFilmTitle(ep)).toLowerCase() === value.toLowerCase()) {
      return res.status(409).json({ error: 'Dieser Filmvorschlag ist bereits übernommen.' });
    }
  } else {
    const mergedValues = suggestionType === 'guest' ? getMergedGuests(ep) : getMergedTopics(ep);
    if (stringsInclude(mergedValues, value)) {
      return res.status(409).json({ error: 'Dieser Vorschlag ist bereits übernommen.' });
    }
  }

  const pending = dbGet(
    `SELECT id FROM episode_suggestions
     WHERE episode_id = ? AND suggestion_type = ? AND LOWER(value) = ? AND status = 'pending'`,
    [episodeId, suggestionType, value.toLowerCase()]
  );
  if (pending) {
    return res.status(409).json({ error: 'Dieser Vorschlag wartet bereits auf Freigabe.' });
  }

  const createdAt = new Date().toISOString();
  dbRun(
    `INSERT INTO episode_suggestions (episode_id, suggestion_type, value, note, status, created_at)
     VALUES (?,?,?,?,?,?)`,
    [episodeId, suggestionType, value, note || null, 'pending', createdAt]
  );
  const suggestionId = dbGet('SELECT last_insert_rowid() as id')?.id || null;
  log('suggestion', `Neuer Vorschlag für Episode #${episodeId}`, {
    episode_id: episodeId,
    suggestion_id: suggestionId,
    type: suggestionType,
    value,
  });
  saveDb();
  res.status(201).json({ ok: true, suggestion_id: suggestionId, status: 'pending' });
});

// ── Admin API ─────────────────────────────────────────────────────────────────
app.get('/api/logs', requireAdmin, (req, res) => {
  const { limit = 100, event, level } = req.query;
  const lim = Math.min(parseInt(limit) || 100, 500);

  let where = '1=1', params = [];
  if (event) { where += ' AND event = ?'; params.push(event); }
  if (level) { where += ' AND level = ?'; params.push(level); }

  const logs  = dbAll(`SELECT * FROM logs WHERE ${where} ORDER BY id DESC LIMIT ?`, [...params, lim]);
  const total = dbGet(`SELECT COUNT(*) as c FROM logs WHERE ${where}`, params)?.c || 0;
  res.json({ total, logs });
});

app.get('/api/suggestions', requireAdmin, (req, res) => {
  const { limit = 100, status = 'pending', type, episode_id } = req.query;
  const lim = Math.min(parseInt(limit) || 100, 500);

  let where = '1=1', params = [];
  if (status) { where += ' AND s.status = ?'; params.push(String(status)); }
  if (type) { where += ' AND s.suggestion_type = ?'; params.push(String(type)); }
  if (episode_id) {
    where += ' AND s.episode_id = ?';
    params.push(parseInt(episode_id, 10) || 0);
  }

  const sql = `
    SELECT s.*, e.title AS episode_title
    FROM episode_suggestions s
    JOIN episodes e ON e.id = s.episode_id
    WHERE ${where}
    ORDER BY CASE WHEN s.status = 'pending' THEN 0 ELSE 1 END, s.id DESC
    LIMIT ?
  `;
  const countSql = `
    SELECT COUNT(*) as c
    FROM episode_suggestions s
    JOIN episodes e ON e.id = s.episode_id
    WHERE ${where}
  `;
  const suggestions = dbAll(sql, [...params, lim]);
  const total = dbGet(countSql, params)?.c || 0;
  res.json({ total, suggestions });
});

app.post('/api/suggestions/:id/review', requireAdmin, (req, res) => {
  const suggestionId = parseInt(req.params.id, 10);
  const action = normalizeText(req.body?.action).toLowerCase();
  const reviewNote = String(req.body?.review_note || '').trim();

  if (!Number.isInteger(suggestionId) || suggestionId <= 0) {
    return res.status(400).json({ error: 'Ungültige Suggestion-ID.' });
  }
  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'Ungültige Aktion. Erlaubt sind approve oder reject.' });
  }
  if (reviewNote.length > 500) {
    return res.status(400).json({ error: 'Die Review-Notiz darf maximal 500 Zeichen lang sein.' });
  }

  const suggestion = dbGet('SELECT * FROM episode_suggestions WHERE id = ?', [suggestionId]);
  if (!suggestion) return res.status(404).json({ error: 'Suggestion nicht gefunden.' });
  if (suggestion.status !== 'pending') {
    return res.status(409).json({ error: 'Diese Suggestion wurde bereits bearbeitet.' });
  }

  const reviewedAt = new Date().toISOString();
  if (action === 'approve') {
    const ep = dbGet(
      'SELECT id, manual_film_title, manual_guests_json, manual_topics_json FROM episodes WHERE id = ?',
      [suggestion.episode_id]
    );
    if (!ep) return res.status(404).json({ error: 'Episode nicht gefunden.' });

    if (suggestion.suggestion_type === 'film') {
      dbRun('UPDATE episodes SET manual_film_title = ? WHERE id = ?', [suggestion.value, suggestion.episode_id]);
    } else {
      const column = suggestion.suggestion_type === 'guest' ? 'manual_guests_json' : 'manual_topics_json';
      const merged = mergeStringArrays(tryJson(ep[column]), [suggestion.value]);
      dbRun(`UPDATE episodes SET ${column} = ? WHERE id = ?`, [JSON.stringify(merged), suggestion.episode_id]);
    }
  }

  dbRun(
    `UPDATE episode_suggestions
     SET status = ?, reviewed_at = ?, review_note = ?
     WHERE id = ?`,
    [action === 'approve' ? 'approved' : 'rejected', reviewedAt, reviewNote || null, suggestionId]
  );
  log('suggestion-review', `Suggestion #${suggestionId} ${action === 'approve' ? 'freigegeben' : 'abgelehnt'}`, {
    suggestion_id: suggestionId,
    episode_id: suggestion.episode_id,
    type: suggestion.suggestion_type,
    value: suggestion.value,
  });
  saveDb();
  res.json({
    ok: true,
    id: suggestionId,
    status: action === 'approve' ? 'approved' : 'rejected',
    episode_id: suggestion.episode_id,
    type: suggestion.suggestion_type,
    value: suggestion.value,
  });
});

app.post('/api/sync', requireAdmin, async (req, res) => {
  try { res.json({ ok: true, ...(await syncFeed()) }); }
  catch (err) {
    log('sync', `Fehler: ${err.message}`, null, 'error');
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/episodes/:id/parse', requireAdmin, async (req, res) => {
  if (!openai) return res.status(503).json({ error: 'OPENAI_API_KEY nicht gesetzt' });
  const ep = dbGet('SELECT * FROM episodes WHERE id = ?', [req.params.id]);
  if (!ep) return res.status(404).json({ error: 'Nicht gefunden' });
  try {
    const data = await parseEpisode(ep);
    saveParsed(ep.id, data);
    log('parse', `Episode #${ep.id} geparst: ${ep.title?.slice(0, 50)}`,
      { episode_id: ep.id, film_title: data.film_title, guests: data.guests.length, chapters: data.chapters.length, topics: data.topics.length });
    res.json({ ok: true, ...data });
  } catch (err) {
    log('parse', `Fehler Episode #${ep.id}: ${err.message}`, { episode_id: ep.id }, 'error');
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/parse-films', requireAdmin, async (req, res) => {
  if (!openai) return res.status(503).json({ error: 'OPENAI_API_KEY nicht gesetzt' });
  const force = req.query.force === '1';
  const episodes = force
    ? dbAll('SELECT id FROM episodes ORDER BY pub_ts ASC')
    : dbAll(`SELECT id FROM episodes
             WHERE (film_title IS NULL OR TRIM(film_title) = '')
               AND (manual_film_title IS NULL OR TRIM(manual_film_title) = '')
             ORDER BY pub_ts ASC`);

  log('parse-films', `Gestartet: ${episodes.length} Episoden (force=${force})`, { queued: episodes.length, force });
  res.json({ ok: true, queued: episodes.length });

  (async () => {
    let done = 0, errors = 0;
    for (const { id } of episodes) {
      const ep = dbGet('SELECT * FROM episodes WHERE id = ?', [id]);
      try {
        const filmTitle = await extractFilmTitle(ep);
        saveFilmTitle(id, filmTitle);
        done++;
        log('parse-films', `${done}/${episodes.length} – ${ep.title?.slice(0, 50)}`, {
          episode_id: id,
          done,
          total: episodes.length,
          film_title: filmTitle,
        });
      } catch (err) {
        errors++;
        log('parse-films', `Fehler #${id}: ${err.message}`, { episode_id: id }, 'error');
      }
      await new Promise(r => setTimeout(r, 300));
    }
    log('parse-films', `Abgeschlossen: ${done} OK, ${errors} Fehler`, { done, errors });
    saveDb();
  })();
});

app.post('/api/parse-all', requireAdmin, async (req, res) => {
  if (!openai) return res.status(503).json({ error: 'OPENAI_API_KEY nicht gesetzt' });
  const force = req.query.force === '1';
  const unparsed = getEpisodesNeedingParse(force);
  log('parse-all', `Gestartet: ${unparsed.length} Episoden (force=${force})`, { queued: unparsed.length, force, parse_version: PARSE_VERSION });
  res.json({ ok: true, queued: unparsed.length });
  (async () => {
    let done = 0, errors = 0;
    for (const { id } of unparsed) {
      const ep = dbGet('SELECT * FROM episodes WHERE id = ?', [id]);
      try {
        const data = await parseEpisode(ep);
        saveParsed(id, data);
        done++;
        log('parse-all', `${done}/${unparsed.length} – ${ep.title?.slice(0, 50)}`, { episode_id: id, done, total: unparsed.length, film_title: data.film_title });
      } catch (err) {
        errors++;
        log('parse-all', `Fehler #${id}: ${err.message}`, { episode_id: id }, 'error');
      }
      await new Promise(r => setTimeout(r, 300));
    }
    log('parse-all', `Abgeschlossen: ${done} OK, ${errors} Fehler`, { done, errors });
    saveDb();
  })();
});

// ── Start ─────────────────────────────────────────────────────────────────────
initDb().then(() => {
  app.listen(PORT, () => {
    log('boot', `Server gestartet auf Port ${PORT}`, { port: PORT });
    log('boot', openai ? 'OpenAI API key gesetzt ✓' : 'Kein OpenAI API key – Parse-Funktionen deaktiviert');
    log('boot', process.env.ADMIN_TOKEN ? 'Admin-Token gesetzt ✓' : '⚠ ADMIN_TOKEN fehlt in .env', null,
      process.env.ADMIN_TOKEN ? 'info' : 'error');
    saveDb();
    const count = dbGet('SELECT COUNT(*) as c FROM episodes');
    if (!count?.c) {
      log('boot', 'DB leer – starte initialen Sync…');
      syncFeed().catch(err => log('boot', `Initialer Sync fehlgeschlagen: ${err.message}`, null, 'error'));
    } else {
      log('boot', `${count.c} Episoden in DB`);
      saveDb();
    }
  });
});

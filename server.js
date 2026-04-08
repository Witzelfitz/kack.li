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

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OPEN_API_KEY;
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());

// CORS – public read access, admin endpoints require token
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Rate limiting for public API (100 req / 15 min per IP)
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zu viele Anfragen, bitte später erneut versuchen.' },
});

// Admin auth middleware
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
  `);
  for (const col of [
    'pub_ts INTEGER',
    'chapters_json TEXT',
    'guests_json TEXT',
    'topics_json TEXT',
    'film_title TEXT',
    'parsed_at TEXT',
  ]) {
    try { db.run(`ALTER TABLE episodes ADD COLUMN ${col}`); } catch {}
  }
  const noPubTs = dbAll('SELECT id, pub_date FROM episodes WHERE pub_ts IS NULL');
  for (const row of noPubTs) {
    const ts = row.pub_date ? Math.floor(new Date(row.pub_date).getTime() / 1000) : 0;
    dbRun('UPDATE episodes SET pub_ts = ? WHERE id = ?', [isNaN(ts) ? 0 : ts, row.id]);
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

// ── RSS Sync ──────────────────────────────────────────────────────────────────
function stripHtml(str) {
  return (str || '').replace(/<[^>]*>/g, '')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#[0-9]+;/g,'').trim();
}

async function syncFeed() {
  console.log('[sync] Fetching RSS...');
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
    const before = dbGet('SELECT id FROM episodes WHERE guid = ?',
      [String(item.guid?._ || item.guid || item.link || item.title || '')]);
    dbRun(`INSERT INTO episodes (guid,title,pub_date,duration,description,summary,audio_url,episode_num,image_url,link,pub_ts)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(guid) DO UPDATE SET
        title=excluded.title,pub_date=excluded.pub_date,pub_ts=excluded.pub_ts,duration=excluded.duration,
        description=excluded.description,summary=excluded.summary,audio_url=excluded.audio_url,
        episode_num=excluded.episode_num,image_url=excluded.image_url,link=excluded.link`,
      [String(item.guid?._ || item.guid || item.link || item.title || ''),
       item.title || '', pubDate, item['itunes:duration'] || '',
       stripHtml(item.description || ''),
       stripHtml(item['itunes:summary'] || item.description || ''),
       item.enclosure?.$.url || '',
       parseInt(item['itunes:episode']) || null,
       item['itunes:image']?.$.href || channel['itunes:image']?.$.href || '',
       item.link || '', isNaN(pubTs) ? 0 : pubTs]);
    if (!before) newCount++;
  }
  const now = new Date().toISOString();
  dbRun(`INSERT INTO meta VALUES ('last_sync',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, [now]);
  saveDb();
  console.log(`[sync] ✓ ${items.length} Episoden (${newCount} neu) | ${now}`);
  return { count: items.length, new: newCount, synced_at: now };
}

// ── OpenAI Parsing ────────────────────────────────────────────────────────────
const PARSE_PROMPT = `Du analysierst Beschreibungen des deutschen Podcasts "Kack & Sachgeschichten".
Die Episodentitel sind oft Wortspiele auf Filme, Serien oder Spiele (z.B. "Assassin's Schiet" → "Assassin's Creed", "Kackzilla" → "Godzilla").
Extrahiere die folgenden Felder und antworte NUR mit validem JSON:

{
  "film_title": "Originaltitel oder null",
  "chapters":   [ { "time": "HH:MM:SS", "title": "Kapitelname" } ],
  "guests":     [ "Name (ggf. mit Kontext)" ],
  "topics":     [ "Thema 1", "Thema 2" ]
}

Regeln:
- film_title: Exakter Originaltitel des Films/der Serie/des Spiels wenn der Episodentitel ein Wortspiel ist. null wenn unklar oder kein Bezug.
- chapters: Nur bei expliziten Zeitstempeln (HH:MM:SS oder MM:SS), exakt übernehmen.
- guests: Nur echte Gäste, NICHT die Hosts Richard und Fred.
- topics: 3–7 prägnante Stichworte zu den Hauptthemen.
- Leeres Array [] wenn nichts vorhanden.`;

async function parseEpisode(ep) {
  if (!openai) throw new Error('OPENAI_API_KEY nicht gesetzt');
  const input = `Titel: ${ep.title}\n\nBeschreibung:\n${ep.description || ep.summary || '(keine)'}`;
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: PARSE_PROMPT },
      { role: 'user',   content: input },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
  });
  const r = JSON.parse(completion.choices[0].message.content);
  return {
    film_title: typeof r.film_title === 'string' ? r.film_title : null,
    chapters:   Array.isArray(r.chapters) ? r.chapters : [],
    guests:     Array.isArray(r.guests)   ? r.guests   : [],
    topics:     Array.isArray(r.topics)   ? r.topics   : [],
  };
}

function saveParsed(id, data) {
  dbRun(
    `UPDATE episodes SET film_title=?, chapters_json=?, guests_json=?, topics_json=?, parsed_at=? WHERE id=?`,
    [data.film_title, JSON.stringify(data.chapters), JSON.stringify(data.guests),
     JSON.stringify(data.topics), new Date().toISOString(), id]
  );
  saveDb();
}

// ── Nightly Cron ──────────────────────────────────────────────────────────────
cron.schedule('0 3 * * *', async () => {
  console.log('[cron] Nachtlauf: Sync + Parse neuer Episoden...');
  try {
    const result = await syncFeed();
    if (openai && result.new > 0) {
      const unparsed = dbAll('SELECT id FROM episodes WHERE parsed_at IS NULL ORDER BY pub_ts ASC');
      console.log(`[cron] ${unparsed.length} ungeparste Episoden...`);
      for (const { id } of unparsed) {
        const ep = dbGet('SELECT * FROM episodes WHERE id = ?', [id]);
        try {
          saveParsed(id, await parseEpisode(ep));
          console.log(`[cron] Geparst: ${ep.title?.slice(0,50)}`);
        } catch (err) {
          console.error(`[cron] Parse-Fehler #${id}:`, err.message);
        }
        await new Promise(r => setTimeout(r, 400));
      }
    }
  } catch (err) {
    console.error('[cron] Fehler:', err.message);
  }
});

// ── Public API ────────────────────────────────────────────────────────────────
app.use('/api', publicLimiter);
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/episodes', (req, res) => {
  const { q, guest, topic, limit = 24, offset = 0 } = req.query;
  const lim = Math.min(parseInt(limit) || 24, 100);
  const off = parseInt(offset) || 0;

  let where = '1=1', params = [];

  if (q?.trim()) {
    where += ' AND (title LIKE ? OR description LIKE ?)';
    const t = `%${q.trim()}%`;
    params.push(t, t);
  }
  if (guest?.trim()) {
    where += ' AND guests_json LIKE ?';
    params.push(`%${guest.trim()}%`);
  }
  if (topic?.trim()) {
    where += ' AND topics_json LIKE ?';
    params.push(`%${topic.trim()}%`);
  }

  const total    = dbGet(`SELECT COUNT(*) as c FROM episodes WHERE ${where}`, params)?.c || 0;
  const episodes = dbAll(`SELECT * FROM episodes WHERE ${where} ORDER BY pub_ts ASC LIMIT ? OFFSET ?`,
    [...params, lim, off]);
  res.json({ total, limit: lim, offset: off, episodes });
});

app.get('/api/episodes/:id', (req, res) => {
  const ep = dbGet('SELECT * FROM episodes WHERE id = ?', [req.params.id]);
  if (!ep) return res.status(404).json({ error: 'Nicht gefunden' });
  res.json(ep);
});

app.get('/api/guests', (req, res) => {
  const rows = dbAll('SELECT guests_json FROM episodes WHERE guests_json IS NOT NULL AND guests_json != ?', ['[]']);
  const counts = {};
  for (const row of rows) {
    for (const g of tryJson(row.guests_json)) {
      counts[g] = (counts[g] || 0) + 1;
    }
  }
  res.json(
    Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
  );
});

app.get('/api/topics', (req, res) => {
  const rows = dbAll('SELECT topics_json FROM episodes WHERE topics_json IS NOT NULL AND topics_json != ?', ['[]']);
  const counts = {};
  for (const row of rows) {
    for (const t of tryJson(row.topics_json)) {
      counts[t] = (counts[t] || 0) + 1;
    }
  }
  res.json(
    Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
  );
});

app.get('/api/status', (req, res) => {
  const total  = dbGet('SELECT COUNT(*) as c FROM episodes')?.c || 0;
  const parsed = dbGet('SELECT COUNT(*) as c FROM episodes WHERE parsed_at IS NOT NULL')?.c || 0;
  res.json({
    episodes:  total,
    parsed,
    last_sync: dbGet("SELECT value FROM meta WHERE key='last_sync'")?.value || null,
    openai:    !!openai,
  });
});

// ── Admin API (token protected) ───────────────────────────────────────────────
app.post('/api/sync', requireAdmin, async (req, res) => {
  try { res.json({ ok: true, ...(await syncFeed()) }); }
  catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.post('/api/episodes/:id/parse', requireAdmin, async (req, res) => {
  if (!openai) return res.status(503).json({ error: 'OPENAI_API_KEY nicht gesetzt' });
  const ep = dbGet('SELECT * FROM episodes WHERE id = ?', [req.params.id]);
  if (!ep) return res.status(404).json({ error: 'Nicht gefunden' });
  try {
    const data = await parseEpisode(ep);
    saveParsed(ep.id, data);
    console.log(`[parse] #${ep.id} "${ep.title?.slice(0,40)}" ✓`);
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/parse-all', requireAdmin, async (req, res) => {
  if (!openai) return res.status(503).json({ error: 'OPENAI_API_KEY nicht gesetzt' });
  const force = req.query.force === '1';
  const sql = force
    ? 'SELECT id FROM episodes ORDER BY pub_ts ASC'
    : 'SELECT id FROM episodes WHERE parsed_at IS NULL ORDER BY pub_ts ASC';
  const unparsed = dbAll(sql);
  res.json({ ok: true, queued: unparsed.length });
  (async () => {
    let done = 0, errors = 0;
    for (const { id } of unparsed) {
      const ep = dbGet('SELECT * FROM episodes WHERE id = ?', [id]);
      try {
        saveParsed(id, await parseEpisode(ep));
        done++;
        console.log(`[parse-all] ${done}/${unparsed.length} – ${ep.title?.slice(0,45)}`);
      } catch (err) {
        errors++;
        console.error(`[parse-all] Fehler #${id}:`, err.message);
      }
      await new Promise(r => setTimeout(r, 300));
    }
    console.log(`[parse-all] Fertig. ${done} OK, ${errors} Fehler.`);
  })();
});

// ── Start ─────────────────────────────────────────────────────────────────────
initDb().then(() => {
  app.listen(PORT, async () => {
    console.log('\n🎙  KuS Episoden → http://localhost:' + PORT);
    console.log('[openai]', openai ? 'API key gesetzt ✓' : 'kein API key');
    console.log('[admin] ', process.env.ADMIN_TOKEN ? 'Token gesetzt ✓' : '⚠ ADMIN_TOKEN fehlt in .env');
    const count = dbGet('SELECT COUNT(*) as c FROM episodes');
    if (!count?.c) {
      console.log('[boot] DB leer – starte initialen Sync...');
      await syncFeed().catch(console.error);
    } else {
      console.log('[boot]', count.c, 'Episoden in DB.\n');
    }
  });
});

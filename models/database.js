import fs from 'fs';
import initSqlJs from 'sql.js';

export async function createDatabase(dbFile) {
  const SQL = await initSqlJs();
  const db = fs.existsSync(dbFile)
    ? new SQL.Database(fs.readFileSync(dbFile))
    : new SQL.Database();

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
    try {
      db.run(`ALTER TABLE episodes ADD COLUMN ${col}`);
    } catch {
      // column already exists
    }
  }

  for (const col of ['reviewed_by TEXT', 'review_source TEXT']) {
    try {
      db.run(`ALTER TABLE episode_suggestions ADD COLUMN ${col}`);
    } catch {
      // column already exists
    }
  }

  function dbAll(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  function dbGet(sql, params = []) {
    return dbAll(sql, params)[0] || null;
  }

  function dbRun(sql, params = []) {
    db.run(sql, params);
  }

  function saveDb() {
    fs.writeFileSync(dbFile, Buffer.from(db.export()));
  }

  return { dbAll, dbGet, dbRun, saveDb };
}

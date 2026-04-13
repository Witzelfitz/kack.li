export function createRepositories({ dbAll, dbGet, dbRun }) {
  const episodes = {
    count(where = '1=1', params = []) {
      return dbGet(`SELECT COUNT(*) as c FROM episodes WHERE ${where}`, params)?.c || 0;
    },

    list(where = '1=1', params = [], limit = 24, offset = 0, orderBy = 'pub_ts DESC, id DESC') {
      return dbAll(
        `SELECT * FROM episodes WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );
    },

    getById(id) {
      return dbGet('SELECT * FROM episodes WHERE id = ?', [id]);
    },

    getByGuid(guid) {
      return dbGet('SELECT id FROM episodes WHERE guid = ?', [guid]);
    },

    allMissingPubTs() {
      return dbAll('SELECT id, pub_date FROM episodes WHERE pub_ts IS NULL');
    },

    allWithTitleAndFormat() {
      return dbAll('SELECT id, title, format_name FROM episodes');
    },

    updatePubTs(id, pubTs) {
      dbRun('UPDATE episodes SET pub_ts = ? WHERE id = ?', [pubTs, id]);
    },

    updateFormat(id, formatName) {
      dbRun('UPDATE episodes SET format_name = ? WHERE id = ?', [formatName, id]);
    },

    upsertFromFeed(data) {
      dbRun(
        `INSERT INTO episodes (guid,title,pub_date,duration,description,summary,audio_url,episode_num,image_url,link,pub_ts,format_name)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(guid) DO UPDATE SET
           title=excluded.title,pub_date=excluded.pub_date,pub_ts=excluded.pub_ts,duration=excluded.duration,
           description=excluded.description,summary=excluded.summary,audio_url=excluded.audio_url,
           episode_num=excluded.episode_num,image_url=excluded.image_url,link=excluded.link,format_name=excluded.format_name`,
        [
          data.guid,
          data.title,
          data.pubDate,
          data.duration,
          data.description,
          data.summary,
          data.audioUrl,
          data.episodeNum,
          data.imageUrl,
          data.link,
          data.pubTs,
          data.formatName,
        ]
      );
    },

    guestsRows() {
      return dbAll('SELECT guests_json, manual_guests_json FROM episodes');
    },

    formatsRows() {
      return dbAll('SELECT format_name FROM episodes WHERE format_name IS NOT NULL AND format_name != ?', ['']);
    },

    topicsRows() {
      return dbAll('SELECT topics_json, manual_topics_json FROM episodes');
    },

    worksRows() {
      return dbAll(
        `SELECT id, title, pub_date, pub_ts, film_title, manual_film_title
         FROM episodes
         ORDER BY pub_ts DESC, id DESC`
      );
    },

    parseIds(parseVersion, force = false) {
      return force
        ? dbAll('SELECT id FROM episodes ORDER BY pub_ts ASC')
        : dbAll(
            'SELECT id FROM episodes WHERE COALESCE(parse_version, 0) < ? ORDER BY pub_ts ASC',
            [parseVersion]
          );
    },

    filmParseIds(force = false) {
      return force
        ? dbAll('SELECT id FROM episodes ORDER BY pub_ts ASC')
        : dbAll(`SELECT id FROM episodes
                 WHERE (film_title IS NULL OR TRIM(film_title) = '')
                   AND (manual_film_title IS NULL OR TRIM(manual_film_title) = '')
                 ORDER BY pub_ts ASC`);
    },

    updateFilmTitle(id, filmTitle) {
      dbRun('UPDATE episodes SET film_title = ? WHERE id = ?', [filmTitle, id]);
    },

    updateParsed(id, data, parseVersion) {
      dbRun(
        `UPDATE episodes SET film_title=?, chapters_json=?, guests_json=?, topics_json=?, parsed_at=?, parse_version=? WHERE id=?`,
        [
          data.film_title,
          JSON.stringify(data.chapters),
          JSON.stringify(data.guests),
          JSON.stringify(data.topics),
          new Date().toISOString(),
          parseVersion,
          id,
        ]
      );
    },

    updateManualFilmTitle(id, value) {
      dbRun('UPDATE episodes SET manual_film_title = ? WHERE id = ?', [value, id]);
    },

    updateManualArray(column, id, values) {
      dbRun(`UPDATE episodes SET ${column} = ? WHERE id = ?`, [JSON.stringify(values), id]);
    },

    totalCount() {
      return dbGet('SELECT COUNT(*) as c FROM episodes')?.c || 0;
    },

    parsedCount(parseVersion) {
      return (
        dbGet('SELECT COUNT(*) as c FROM episodes WHERE COALESCE(parse_version, 0) >= ?', [parseVersion])?.c || 0
      );
    },

    qualityCounts() {
      return (
        dbGet(
          `SELECT
             SUM(CASE WHEN audio_url IS NULL OR TRIM(audio_url) = '' THEN 1 ELSE 0 END) AS missing_audio,
             SUM(CASE WHEN duration IS NULL OR TRIM(duration) = '' THEN 1 ELSE 0 END) AS missing_duration,
             COUNT(*) AS total
           FROM episodes`
        ) || { missing_audio: 0, missing_duration: 0, total: 0 }
      );
    },

    missingMediaRows(limit = 1000) {
      return dbAll(
        `SELECT id, guid, title, audio_url, duration, chapters_json
         FROM episodes
         WHERE audio_url IS NULL OR TRIM(audio_url) = '' OR duration IS NULL OR TRIM(duration) = ''
         ORDER BY pub_ts DESC, id DESC
         LIMIT ?`,
        [limit]
      );
    },

    updateMediaFields(id, { audioUrl, duration }) {
      const sets = [];
      const params = [];

      if (audioUrl !== undefined) {
        sets.push('audio_url = ?');
        params.push(audioUrl);
      }
      if (duration !== undefined) {
        sets.push('duration = ?');
        params.push(duration);
      }
      if (!sets.length) return;

      params.push(id);
      dbRun(`UPDATE episodes SET ${sets.join(', ')} WHERE id = ?`, params);
    },
  };

  const meta = {
    set(key, value) {
      dbRun('INSERT INTO meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, value]);
    },

    get(key) {
      return dbGet('SELECT value FROM meta WHERE key = ?', [key])?.value || null;
    },
  };

  const logs = {
    insert(ts, level, event, message, metaJson = null) {
      dbRun('INSERT INTO logs (ts, level, event, message, meta_json) VALUES (?,?,?,?,?)', [
        ts,
        level,
        event,
        message,
        metaJson ? JSON.stringify(metaJson) : null,
      ]);
    },

    trim(limit = 2000) {
      dbRun('DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT ?)', [limit]);
    },

    list(where = '1=1', params = [], limit = 100) {
      return dbAll(`SELECT * FROM logs WHERE ${where} ORDER BY id DESC LIMIT ?`, [...params, limit]);
    },

    count(where = '1=1', params = []) {
      return dbGet(`SELECT COUNT(*) as c FROM logs WHERE ${where}`, params)?.c || 0;
    },
  };

  const suggestions = {
    getById(id) {
      return dbGet('SELECT * FROM episode_suggestions WHERE id = ?', [id]);
    },

    findPendingDuplicate(episodeId, type, lowerValue) {
      return dbGet(
        `SELECT id FROM episode_suggestions
         WHERE episode_id = ? AND suggestion_type = ? AND LOWER(value) = ? AND status = 'pending'`,
        [episodeId, type, lowerValue]
      );
    },

    create({ episodeId, type, value, note, status = 'pending', createdAt }) {
      dbRun(
        `INSERT INTO episode_suggestions (episode_id, suggestion_type, value, note, status, created_at)
         VALUES (?,?,?,?,?,?)`,
        [episodeId, type, value, note || null, status, createdAt]
      );
      return dbGet('SELECT last_insert_rowid() as id')?.id || null;
    },

    listWithEpisodeTitle(where = '1=1', params = [], limit = 100) {
      const sql = `
        SELECT s.*, e.title AS episode_title
        FROM episode_suggestions s
        JOIN episodes e ON e.id = s.episode_id
        WHERE ${where}
        ORDER BY CASE WHEN s.status = 'pending' THEN 0 ELSE 1 END, s.id DESC
        LIMIT ?
      `;
      return dbAll(sql, [...params, limit]);
    },

    listForEpisode(episodeId, { status = null, limit = 100 } = {}) {
      let where = 's.episode_id = ?';
      const params = [episodeId];
      if (status) {
        where += ' AND s.status = ?';
        params.push(status);
      }

      const sql = `
        SELECT s.*, e.title AS episode_title
        FROM episode_suggestions s
        JOIN episodes e ON e.id = s.episode_id
        WHERE ${where}
        ORDER BY s.id DESC
        LIMIT ?
      `;
      return dbAll(sql, [...params, limit]);
    },

    listPending(limit = 50) {
      const sql = `
        SELECT s.*, e.title AS episode_title
        FROM episode_suggestions s
        JOIN episodes e ON e.id = s.episode_id
        WHERE s.status = 'pending'
        ORDER BY s.id ASC
        LIMIT ?
      `;
      return dbAll(sql, [limit]);
    },

    countWithEpisodeTitle(where = '1=1', params = []) {
      const sql = `
        SELECT COUNT(*) as c
        FROM episode_suggestions s
        JOIN episodes e ON e.id = s.episode_id
        WHERE ${where}
      `;
      return dbGet(sql, params)?.c || 0;
    },

    markReviewed(id, status, reviewedAt, reviewNote = null, reviewedBy = null, reviewSource = null) {
      dbRun(
        `UPDATE episode_suggestions
         SET status = ?, reviewed_at = ?, review_note = ?, reviewed_by = ?, review_source = ?
         WHERE id = ?`,
        [status, reviewedAt, reviewNote || null, reviewedBy || null, reviewSource || null, id]
      );
    },
  };

  return { episodes, meta, logs, suggestions };
}

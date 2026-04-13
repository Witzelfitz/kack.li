import { getEffectiveFilmTitle, getWorkIdFromFilmTitle, normalizeText } from '../lib/episode-utils.js';

function buildWorks(episodeRows = []) {
  const worksMap = new Map();

  for (const row of episodeRows) {
    const title = getEffectiveFilmTitle(row);
    const workId = getWorkIdFromFilmTitle(title);
    if (!workId || !title) continue;

    if (!worksMap.has(workId)) {
      worksMap.set(workId, {
        id: workId,
        title,
        episode_count: 0,
        last_pub_ts: 0,
        last_pub_date: null,
        episodes: [],
      });
    }

    const work = worksMap.get(workId);
    work.episode_count += 1;

    const pubTs = Number.parseInt(row.pub_ts, 10) || 0;
    if (pubTs >= work.last_pub_ts) {
      work.last_pub_ts = pubTs;
      work.last_pub_date = row.pub_date || null;
    }

    work.episodes.push({
      id: row.id,
      title: row.title,
      pub_date: row.pub_date || null,
      pub_ts: pubTs,
    });
  }

  for (const work of worksMap.values()) {
    work.episodes.sort((a, b) => (b.pub_ts || 0) - (a.pub_ts || 0) || b.id - a.id);
  }

  return Array.from(worksMap.values()).sort(
    (a, b) => b.episode_count - a.episode_count || (b.last_pub_ts || 0) - (a.last_pub_ts || 0) || a.title.localeCompare(b.title, 'de')
  );
}

export function createWorksService({ episodes }) {
  function listWorks({ q = '', limit = 50, offset = 0 } = {}) {
    const all = buildWorks(episodes.worksRows());
    const query = normalizeText(q).toLowerCase();

    const filtered = query
      ? all.filter((work) => normalizeText(work.title).toLowerCase().includes(query))
      : all;

    const slice = filtered.slice(offset, offset + limit).map((work) => ({
      id: work.id,
      title: work.title,
      episode_count: work.episode_count,
      last_pub_date: work.last_pub_date,
      last_pub_ts: work.last_pub_ts,
    }));

    return {
      total: filtered.length,
      limit,
      offset,
      works: slice,
    };
  }

  function getWorkById(id) {
    const all = buildWorks(episodes.worksRows());
    const work = all.find((item) => item.id === id);
    if (!work) return null;

    return {
      id: work.id,
      title: work.title,
      episode_count: work.episode_count,
      last_pub_date: work.last_pub_date,
      last_pub_ts: work.last_pub_ts,
      episodes: work.episodes,
    };
  }

  return {
    listWorks,
    getWorkById,
  };
}

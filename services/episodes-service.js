import fetch from 'node-fetch';
import xml2js from 'xml2js';

import { RSS_URL } from '../config/constants.js';
import {
  detectEpisodeFormat,
  sanitizeHttpUrl,
  stripHtml,
} from '../lib/episode-utils.js';

export function createEpisodesService({
  episodes,
  meta,
  saveDb,
  log,
  parseService,
  parseVersion,
}) {
  function getEpisodesNeedingParse(force = false) {
    return episodes.parseIds(parseVersion, force);
  }

  async function syncFeed() {
    log('sync', 'RSS-Feed wird abgerufen…');

    const res = await fetch(RSS_URL, { headers: { 'User-Agent': 'KuS-EpisodenApp/1.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const xml = await res.text();
    const parsed = await xml2js.parseStringPromise(xml, { explicitArray: false });
    const channel = parsed.rss.channel;
    const items = Array.isArray(channel.item) ? channel.item : [channel.item];

    let newCount = 0;

    for (const item of items) {
      const pubDate = item.pubDate || '';
      const pubTs = pubDate ? Math.floor(new Date(pubDate).getTime() / 1000) : 0;
      const title = item.title || '';
      const guid = String(item.guid?._ || item.guid || item.link || title || '');

      const before = episodes.getByGuid(guid);

      episodes.upsertFromFeed({
        guid,
        title,
        pubDate,
        duration: item['itunes:duration'] || '',
        description: stripHtml(item.description || ''),
        summary: stripHtml(item['itunes:summary'] || item.description || ''),
        audioUrl: sanitizeHttpUrl(item.enclosure?.$.url, RSS_URL),
        episodeNum: parseInt(item['itunes:episode'], 10) || null,
        imageUrl: sanitizeHttpUrl(item['itunes:image']?.$.href || channel['itunes:image']?.$.href, RSS_URL),
        link: sanitizeHttpUrl(item.link, RSS_URL),
        pubTs: Number.isNaN(pubTs) ? 0 : pubTs,
        formatName: detectEpisodeFormat(title),
      });

      if (!before) newCount++;
    }

    const now = new Date().toISOString();
    meta.set('last_sync', now);

    log('sync', `Abgeschlossen: ${items.length} Episoden, ${newCount} neu`, {
      total: items.length,
      new: newCount,
    });

    saveDb();
    return { count: items.length, new: newCount, synced_at: now };
  }

  function saveParsed(id, data) {
    episodes.updateParsed(id, data, parseVersion);
    saveDb();
  }

  function saveFilmTitle(id, filmTitle) {
    episodes.updateFilmTitle(id, filmTitle);
    saveDb();
  }

  async function parseSingleEpisode(ep) {
    const data = await parseService.parseEpisode(ep);
    saveParsed(ep.id, data);

    log('parse', `Episode #${ep.id} geparst: ${ep.title?.slice(0, 50)}`, {
      episode_id: ep.id,
      film_title: data.film_title,
      guests: data.guests.length,
      chapters: data.chapters.length,
      topics: data.topics.length,
    });

    return data;
  }

  function startParseFilmsJob(force = false) {
    const list = episodes.filmParseIds(force);

    log('parse-films', `Gestartet: ${list.length} Episoden (force=${force})`, {
      queued: list.length,
      force,
    });

    (async () => {
      let done = 0;
      let errors = 0;

      for (const { id } of list) {
        const ep = episodes.getById(id);
        try {
          const filmTitle = await parseService.extractFilmTitle(ep);
          saveFilmTitle(id, filmTitle);
          done++;
          log('parse-films', `${done}/${list.length} – ${ep.title?.slice(0, 50)}`, {
            episode_id: id,
            done,
            total: list.length,
            film_title: filmTitle,
          });
        } catch (err) {
          errors++;
          log('parse-films', `Fehler #${id}: ${err.message}`, { episode_id: id }, 'error');
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      log('parse-films', `Abgeschlossen: ${done} OK, ${errors} Fehler`, { done, errors });
      saveDb();
    })();

    return list.length;
  }

  function startParseAllJob(force = false) {
    const list = getEpisodesNeedingParse(force);

    log('parse-all', `Gestartet: ${list.length} Episoden (force=${force})`, {
      queued: list.length,
      force,
      parse_version: parseVersion,
    });

    (async () => {
      let done = 0;
      let errors = 0;

      for (const { id } of list) {
        const ep = episodes.getById(id);
        try {
          const data = await parseService.parseEpisode(ep);
          saveParsed(id, data);
          done++;
          log('parse-all', `${done}/${list.length} – ${ep.title?.slice(0, 50)}`, {
            episode_id: id,
            done,
            total: list.length,
            film_title: data.film_title,
          });
        } catch (err) {
          errors++;
          log('parse-all', `Fehler #${id}: ${err.message}`, { episode_id: id }, 'error');
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      log('parse-all', `Abgeschlossen: ${done} OK, ${errors} Fehler`, { done, errors });
      saveDb();
    })();

    return list.length;
  }

  async function runNightlyJob() {
    log('cron', 'Nachtlauf gestartet');

    try {
      const result = await syncFeed();

      if (parseService.enabled) {
        const unparsed = getEpisodesNeedingParse();
        log('cron', `${unparsed.length} Episoden benötigen Parsing`, {
          count: unparsed.length,
          parse_version: parseVersion,
          new: result.new,
        });

        let done = 0;
        let errors = 0;

        for (const { id } of unparsed) {
          const ep = episodes.getById(id);
          try {
            const data = await parseService.parseEpisode(ep);
            saveParsed(id, data);
            done++;
            log('cron', `Geparst: ${ep.title?.slice(0, 60)}`, {
              episode_id: id,
              film_title: data.film_title,
            });
          } catch (err) {
            errors++;
            log('cron', `Parse-Fehler Episode #${id}: ${err.message}`, { episode_id: id }, 'error');
          }
          await new Promise((resolve) => setTimeout(resolve, 400));
        }

        log('cron', `Nachtlauf abgeschlossen: ${done} OK, ${errors} Fehler`, {
          done,
          errors,
          parse_version: parseVersion,
        });
      } else {
        log('cron', 'Kein OpenAI-Key – Parsing übersprungen', {
          new: result.new,
          parse_version: parseVersion,
        });
      }
    } catch (err) {
      log('cron', `Fehler: ${err.message}`, null, 'error');
    }

    saveDb();
  }

  return {
    getEpisodesNeedingParse,
    syncFeed,
    parseSingleEpisode,
    startParseFilmsJob,
    startParseAllJob,
    runNightlyJob,
  };
}

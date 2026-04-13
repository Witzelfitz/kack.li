import fetch from 'node-fetch';
import xml2js from 'xml2js';

import { RSS_URL } from '../config/constants.js';
import {
  detectEpisodeFormat,
  normalizeChapters,
  sanitizeHttpUrl,
  stripHtml,
  tryJson,
} from '../lib/episode-utils.js';

function parseTimestampToSeconds(value) {
  const text = String(value || '').trim();
  if (!text) return 0;

  const parts = text.split(':').map((part) => Number.parseInt(part, 10));
  if (parts.some((part) => Number.isNaN(part) || part < 0)) return 0;

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 1) {
    return parts[0];
  }
  return 0;
}

function secondsToHms(totalSeconds) {
  const seconds = Math.max(0, Number.parseInt(totalSeconds, 10) || 0);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function extractDurationFromItem(item) {
  return String(item?.['itunes:duration'] || item?.duration || item?.['media:content']?.$.duration || '').trim();
}

function extractAudioFromItem(item) {
  return sanitizeHttpUrl(item?.enclosure?.$.url || item?.['media:content']?.$.url, RSS_URL);
}

function estimateDurationFromChapters(chaptersJson) {
  const chapters = normalizeChapters(tryJson(chaptersJson));
  if (!chapters.length) return '';

  const maxSeconds = chapters.reduce((max, chapter) => {
    const sec = parseTimestampToSeconds(chapter.time);
    return sec > max ? sec : max;
  }, 0);

  return maxSeconds > 0 ? secondsToHms(maxSeconds) : '';
}

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

  async function fetchFeedData() {
    const res = await fetch(RSS_URL, { headers: { 'User-Agent': 'KuS-EpisodenApp/1.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const xml = await res.text();
    const parsed = await xml2js.parseStringPromise(xml, { explicitArray: false });
    const channel = parsed.rss.channel;
    const items = Array.isArray(channel.item) ? channel.item : [channel.item];

    return { channel, items };
  }

  async function syncFeed() {
    log('sync', 'RSS-Feed wird abgerufen…');

    const { channel, items } = await fetchFeedData();
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
        duration: extractDurationFromItem(item),
        description: stripHtml(item.description || ''),
        summary: stripHtml(item['itunes:summary'] || item.description || ''),
        audioUrl: extractAudioFromItem(item),
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

  async function getDataQualityReport(sampleLimit = 25) {
    const counts = episodes.qualityCounts();
    const rows = episodes.missingMediaRows(sampleLimit);

    return {
      total_episodes: counts.total || 0,
      missing_audio_url: counts.missing_audio || 0,
      missing_duration: counts.missing_duration || 0,
      targets: {
        missing_audio_url: 0,
        missing_duration: 0,
      },
      samples: rows.map((row) => {
        const missingAudio = !String(row.audio_url || '').trim();
        const missingDuration = !String(row.duration || '').trim();
        const estimated = missingDuration ? estimateDurationFromChapters(row.chapters_json) : '';

        return {
          id: row.id,
          title: row.title,
          missing_audio_url: missingAudio,
          missing_duration: missingDuration,
          chapter_duration_candidate: estimated || null,
        };
      }),
    };
  }

  async function repairDataQuality(limit = 2000) {
    const rows = episodes.missingMediaRows(limit);
    if (!rows.length) {
      return {
        scanned: 0,
        repaired_audio_url: 0,
        repaired_duration: 0,
        repaired_duration_from_feed: 0,
        repaired_duration_from_chapters: 0,
        remaining_missing_audio_url: 0,
        remaining_missing_duration: 0,
        unresolved_samples: [],
      };
    }

    const { items } = await fetchFeedData();
    const feedByGuid = new Map(
      items.map((item) => [String(item.guid?._ || item.guid || item.link || item.title || ''), item])
    );

    let repairedAudio = 0;
    let repairedDurationFromFeed = 0;
    let repairedDurationFromChapters = 0;
    const unresolved = [];

    for (const row of rows) {
      const missingAudio = !String(row.audio_url || '').trim();
      const missingDuration = !String(row.duration || '').trim();
      const item = feedByGuid.get(String(row.guid || ''));

      const updates = {};

      if (missingAudio && item) {
        const nextAudio = extractAudioFromItem(item);
        if (nextAudio) {
          updates.audioUrl = nextAudio;
          repairedAudio++;
        }
      }

      if (missingDuration) {
        let nextDuration = item ? extractDurationFromItem(item) : '';
        if (!nextDuration) {
          nextDuration = estimateDurationFromChapters(row.chapters_json);
          if (nextDuration) repairedDurationFromChapters++;
        } else {
          repairedDurationFromFeed++;
        }

        if (nextDuration) {
          updates.duration = nextDuration;
        }
      }

      if (Object.keys(updates).length) {
        episodes.updateMediaFields(row.id, updates);
      }

      const unresolvedAudio = missingAudio && updates.audioUrl === undefined;
      const unresolvedDuration = missingDuration && updates.duration === undefined;

      if (unresolvedAudio || unresolvedDuration) {
        unresolved.push({
          id: row.id,
          title: row.title,
          missing_audio_url: unresolvedAudio,
          missing_duration: unresolvedDuration,
        });
      }
    }

    saveDb();

    const counts = episodes.qualityCounts();
    const repairedDuration = repairedDurationFromFeed + repairedDurationFromChapters;

    log('quality', `Reparaturlauf abgeschlossen (${rows.length} geprüft)`, {
      scanned: rows.length,
      repaired_audio_url: repairedAudio,
      repaired_duration: repairedDuration,
      repaired_duration_from_feed: repairedDurationFromFeed,
      repaired_duration_from_chapters: repairedDurationFromChapters,
      remaining_missing_audio_url: counts.missing_audio || 0,
      remaining_missing_duration: counts.missing_duration || 0,
    });

    return {
      scanned: rows.length,
      repaired_audio_url: repairedAudio,
      repaired_duration: repairedDuration,
      repaired_duration_from_feed: repairedDurationFromFeed,
      repaired_duration_from_chapters: repairedDurationFromChapters,
      remaining_missing_audio_url: counts.missing_audio || 0,
      remaining_missing_duration: counts.missing_duration || 0,
      unresolved_samples: unresolved.slice(0, 25),
    };
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
    getDataQualityReport,
    repairDataQuality,
    startParseFilmsJob,
    startParseAllJob,
    runNightlyJob,
  };
}

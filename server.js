#!/usr/bin/env node
import 'dotenv/config';
import path from 'path';
import cron from 'node-cron';
import OpenAI from 'openai';
import { fileURLToPath } from 'url';

import { PARSE_VERSION, PUBLIC_CORS_PATTERNS } from './config/constants.js';
import { detectEpisodeFormat } from './lib/episode-utils.js';
import { createDatabase } from './models/database.js';
import { createRepositories } from './models/repositories.js';
import { createRequireAdmin } from './middleware/auth.js';
import { createPublicCors } from './middleware/public-cors.js';
import { publicLimiter, suggestionLimiter } from './middleware/rate-limiters.js';
import { createLogger } from './services/logger.js';
import { createParseService } from './services/parse-service.js';
import { createEpisodesService } from './services/episodes-service.js';
import { createWorksService } from './services/works-service.js';
import { createPublicController } from './controllers/public-controller.js';
import { createAdminController } from './controllers/admin-controller.js';
import { createPublicRoutes } from './routes/public-routes.js';
import { createAdminRoutes } from './routes/admin-routes.js';
import { createApp } from './app.js';
import {
  getEffectiveFilmTitle,
  getMergedGuests,
  getMergedTopics,
  mergeStringArrays,
  normalizeGuestEntry,
  normalizeText,
  normalizeTopicEntry,
  serializeEpisode,
  stringsInclude,
  tryJson,
} from './lib/episode-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'episodes.db');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OPEN_API_KEY;
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

async function bootstrap() {
  const database = await createDatabase(DB_FILE);
  const { episodes, logs, meta, suggestions } = createRepositories(database);

  for (const row of episodes.allMissingPubTs()) {
    const ts = row.pub_date ? Math.floor(new Date(row.pub_date).getTime() / 1000) : 0;
    episodes.updatePubTs(row.id, Number.isNaN(ts) ? 0 : ts);
  }

  for (const row of episodes.allWithTitleAndFormat()) {
    const formatName = detectEpisodeFormat(row.title);
    if ((row.format_name || null) === formatName) continue;
    episodes.updateFormat(row.id, formatName);
  }

  database.saveDb();

  const log = createLogger(logs);
  const parseService = createParseService(openai);
  const episodesService = createEpisodesService({
    episodes,
    meta,
    saveDb: database.saveDb,
    log,
    parseService,
    parseVersion: PARSE_VERSION,
  });

  const worksService = createWorksService({ episodes });

  const publicController = createPublicController({
    episodes,
    suggestions,
    meta,
    worksService,
    parseVersion: PARSE_VERSION,
    openaiEnabled: parseService.enabled,
    serializeEpisode,
    normalizeText,
    tryJson,
    mergeStringArrays,
    stringsInclude,
    getMergedGuests,
    getMergedTopics,
    getEffectiveFilmTitle,
    normalizeGuestEntry,
    normalizeTopicEntry,
    log,
    saveDb: database.saveDb,
  });

  const adminController = createAdminController({
    episodes,
    logs,
    suggestions,
    normalizeText,
    tryJson,
    mergeStringArrays,
    log,
    saveDb: database.saveDb,
    parseService,
    episodesService,
  });

  const publicRoutes = createPublicRoutes({
    controller: publicController,
    suggestionLimiter,
  });

  const adminRoutes = createAdminRoutes({
    controller: adminController,
    requireAdmin: createRequireAdmin(process.env.ADMIN_TOKEN),
  });

  const app = createApp({
    publicCors: createPublicCors(PUBLIC_CORS_PATTERNS),
    publicLimiter,
    publicRoutes,
    adminRoutes,
    staticDir: path.join(__dirname, 'public'),
  });

  cron.schedule('0 3 * * *', async () => {
    await episodesService.runNightlyJob();
  });

  app.listen(PORT, () => {
    log('boot', `Server gestartet auf Port ${PORT}`, { port: PORT });
    log('boot', parseService.enabled ? 'OpenAI API key gesetzt ✓' : 'Kein OpenAI API key – Parse-Funktionen deaktiviert');
    log(
      'boot',
      process.env.ADMIN_TOKEN ? 'Admin-Token gesetzt ✓' : '⚠ ADMIN_TOKEN fehlt in .env',
      null,
      process.env.ADMIN_TOKEN ? 'info' : 'error'
    );

    database.saveDb();

    const count = episodes.totalCount();
    if (!count) {
      log('boot', 'DB leer – starte initialen Sync…');
      episodesService.syncFeed().catch((err) =>
        log('boot', `Initialer Sync fehlgeschlagen: ${err.message}`, null, 'error')
      );
    } else {
      log('boot', `${count} Episoden in DB`);
      database.saveDb();
    }
  });
}

bootstrap().catch((err) => {
  console.error('[boot] Startup fehlgeschlagen:', err);
  process.exit(1);
});

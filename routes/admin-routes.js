import express from 'express';

export function createAdminRoutes({ controller, requireAdmin }) {
  const router = express.Router();

  router.use(requireAdmin);

  router.get('/logs', controller.listLogs);
  router.get('/suggestions', controller.listSuggestions);
  router.post('/suggestions/:id/review', controller.reviewSuggestion);
  router.post('/sync', controller.sync);
  router.get('/data-quality', controller.getDataQuality);
  router.post('/data-quality/repair', controller.repairDataQuality);
  router.post('/episodes/:id/parse', controller.parseEpisode);
  router.post('/parse-films', controller.parseFilms);
  router.post('/parse-all', controller.parseAll);

  return router;
}

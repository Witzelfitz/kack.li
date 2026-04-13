import express from 'express';

export function createPublicRoutes({ controller, suggestionLimiter }) {
  const router = express.Router();

  router.get('/episodes', controller.listEpisodes);
  router.get('/episodes/:id', controller.getEpisodeById);
  router.get('/episodes/:id/suggestions', controller.listEpisodeSuggestions);
  router.get('/episodes/:id/suggestions/history', controller.getEpisodeSuggestionHistory);
  router.get('/guests', controller.listGuests);
  router.get('/formats', controller.listFormats);
  router.get('/topics', controller.listTopics);
  router.get('/works', controller.listWorks);
  router.get('/works/:id', controller.getWorkById);
  router.get('/status', controller.getStatus);
  router.post('/episodes/:id/suggestions', suggestionLimiter, controller.createSuggestion);

  return router;
}

import express from 'express';

export function createJarvisRoutes({ controller, requireJarvis }) {
  const router = express.Router();

  router.get('/review-link', controller.reviewViaLink);

  router.use(requireJarvis);

  router.get('/suggestions/pending', controller.listPending);
  router.post('/suggestions/:id/review', controller.reviewSuggestion);

  return router;
}

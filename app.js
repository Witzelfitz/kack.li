import express from 'express';

export function createApp({
  publicCors,
  publicLimiter,
  publicRoutes,
  adminRoutes,
  jarvisRoutes,
  staticDir,
}) {
  const app = express();

  app.use(express.json());
  app.use(publicCors);
  app.use('/api', publicLimiter);
  app.use('/api', publicRoutes);
  app.use('/api/jarvis', jarvisRoutes);
  app.use('/api', adminRoutes);
  app.use(express.static(staticDir));

  return app;
}

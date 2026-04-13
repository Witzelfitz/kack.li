import express from 'express';

export function createApp({
  publicCors,
  publicLimiter,
  publicRoutes,
  adminRoutes,
  jarvisRoutes,
  staticDir,
  trustProxy,
}) {
  const app = express();

  if (trustProxy !== undefined) {
    app.set('trust proxy', trustProxy);
  }

  app.use(express.json());
  app.use(publicCors);
  app.use('/api', publicLimiter);
  app.use('/api', publicRoutes);
  app.use('/internal/jarvis', jarvisRoutes);
  app.use('/api', adminRoutes);
  app.use(express.static(staticDir));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/internal')) return next();
    return res.sendFile(`${staticDir}/index.html`);
  });

  return app;
}

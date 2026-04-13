export function createPublicCors(patterns) {
  return function publicCors(req, res, next) {
    const allowPublicCors =
      !req.headers.authorization &&
      ['GET', 'OPTIONS'].includes(req.method) &&
      patterns.some((pattern) => pattern.test(req.path));

    if (allowPublicCors) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }

    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  };
}

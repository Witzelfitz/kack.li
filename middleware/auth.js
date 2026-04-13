export function createRequireAdmin(adminToken) {
  return function requireAdmin(req, res, next) {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!adminToken || token !== adminToken) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  };
}

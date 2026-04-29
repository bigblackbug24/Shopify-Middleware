const logger = require('../utils/logger');

/**
 * HTTP request logger middleware.
 *
 * Logs every incoming request and its response:
 *   → POST /webhook/order-created
 *   ← 200 POST /webhook/order-created  45ms
 *
 * Skips /health to avoid log spam from load balancer pings.
 * Skips /admin/queues (Bull Board) to keep logs clean.
 */
function requestLogger(req, res, next) {
  // Skip noisy endpoints
  if (req.path === '/health' || req.path.startsWith('/admin/queues')) {
    return next();
  }

  const startTime = Date.now();

  // Log incoming request
  logger.info(`→ ${req.method} ${req.path}`, {
    method:    req.method,
    path:      req.path,
    ip:        req.ip,
    userAgent: req.headers['user-agent'],
  });

  // Intercept res.json to log response
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    const duration = Date.now() - startTime;
    const level    = res.statusCode >= 500 ? 'error'
                   : res.statusCode >= 400 ? 'warn'
                   : 'info';

    logger[level](`← ${res.statusCode} ${req.method} ${req.path}`, {
      method:     req.method,
      path:       req.path,
      statusCode: res.statusCode,
      durationMs: duration,
    });

    return originalJson(body);
  };

  next();
}

module.exports = requestLogger;

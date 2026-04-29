require('./config');  // Validate all env vars — crash early if missing

const app    = require('./app');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  logger.info(`🚀 Server running on http://localhost:${PORT}`);
  logger.info(`   Environment : ${process.env.NODE_ENV || 'development'}`);
  logger.info(`   Health check: http://localhost:${PORT}/health`);
  logger.info(`   Queue UI    : http://localhost:${PORT}/admin/queues`);
});

// ── Graceful shutdown ─────────────────────────────────────────────────
// On SIGTERM/SIGINT:
//  1. Stop accepting new HTTP requests
//  2. Wait for in-flight requests to finish
//  3. Close DB connection pool
//  4. Close Redis connection
//  5. Exit cleanly
//
// This prevents data loss on deploy/restart.
let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`${signal} received — shutting down gracefully`);

  // 1. Stop accepting new connections
  server.close(async () => {
    logger.info('HTTP server closed — no new requests accepted');

    try {
      // 2. Close MySQL connection pool
      const db = require('./models/db');
      await db.destroy();
      logger.info('MySQL connection pool closed');
    } catch (err) {
      logger.warn('Error closing MySQL pool', { error: err.message });
    }

    try {
      // 3. Close Redis connection
      const connection = require('./queues/connection');
      await connection.quit();
      logger.info('Redis connection closed');
    } catch (err) {
      logger.warn('Error closing Redis connection', { error: err.message });
    }

    logger.info('Shutdown complete ✅');
    process.exit(0);
  });

  // Force exit after 15s if graceful shutdown hangs
  setTimeout(() => {
    logger.error('Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 15000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

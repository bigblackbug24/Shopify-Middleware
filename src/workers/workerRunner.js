/**
 * Worker entry point — runs as a SEPARATE process from the API server.
 *
 * Start with:  npm run worker
 * Dev mode:    npm run worker:dev   (nodemon auto-restart)
 *
 * Runs BOTH workers:
 *  - orderWorker     → processes order-processing queue
 *  - inventoryWorker → processes inventory-processing queue
 */
require('dotenv').config();
require('../config');  // Validate all env vars — crash early if missing

const { orderWorker }     = require('./orderWorker');
const { inventoryWorker } = require('./inventoryWorker');
const logger              = require('../utils/logger');

logger.info('🔧 Workers started', {
  queues:      ['order-processing', 'inventory-processing'],
  env:         process.env.NODE_ENV || 'development',
  pid:         process.pid,
});

// ── Graceful shutdown ─────────────────────────────────────────────────
// Wait for ALL in-flight jobs to finish before exiting.
let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`${signal} received — shutting down all workers gracefully...`);

  try {
    await Promise.all([
      orderWorker.close(),
      inventoryWorker.close(),
    ]);
    logger.info('All workers shut down cleanly ✅');
    process.exit(0);
  } catch (err) {
    logger.error('Error during worker shutdown', { error: err.message });
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

// ── Safety net ────────────────────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection in worker process', {
    reason: String(reason),
  });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception in worker process — restarting', {
    error: err.message,
    stack: err.stack,
  });
  process.exit(1);
});

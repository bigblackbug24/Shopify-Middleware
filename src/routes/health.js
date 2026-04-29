const express              = require('express');
const db                   = require('../models/db');
const connection           = require('../queues/connection');
const { getQueueMetrics }  = require('../queues/orderQueue');
const { inventoryQueue }   = require('../queues/inventoryQueue');

const router = express.Router();

/**
 * GET /health
 *
 * Returns status of the app and all its dependencies.
 * 200 = everything ok
 * 503 = one or more services degraded
 */
router.get('/', async (req, res) => {
  const health = {
    status:    'ok',
    timestamp: new Date().toISOString(),
    uptime:    Math.floor(process.uptime()) + 's',
    services:  {},
    queues:    {},
  };

  // ── Check MySQL ───────────────────────────────────────────────────
  try {
    await db.raw('SELECT 1');
    health.services.mysql = 'ok';
  } catch (err) {
    health.services.mysql = 'error';
    health.status = 'degraded';
  }

  // ── Check Redis ───────────────────────────────────────────────────
  try {
    await connection.ping();
    health.services.redis = 'ok';
  } catch (err) {
    health.services.redis = 'error';
    health.status = 'degraded';
  }

  // ── Queue metrics ─────────────────────────────────────────────────
  try {
    health.queues.orders = await getQueueMetrics();
  } catch (err) {
    health.queues.orders = { error: 'unavailable' };
  }

  try {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      inventoryQueue.getWaitingCount(),
      inventoryQueue.getActiveCount(),
      inventoryQueue.getCompletedCount(),
      inventoryQueue.getFailedCount(),
      inventoryQueue.getDelayedCount(),
    ]);
    health.queues.inventory = { waiting, active, completed, failed, delayed };
  } catch (err) {
    health.queues.inventory = { error: 'unavailable' };
  }

  const httpStatus = health.status === 'ok' ? 200 : 503;
  return res.status(httpStatus).json(health);
});

module.exports = router;

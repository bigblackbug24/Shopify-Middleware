const { Queue, QueueEvents } = require('bullmq');
const connection = require('./connection');
const config     = require('../config');
const logger     = require('../utils/logger');

/**
 * Order Processing Queue
 *
 * Decouples webhook receipt from order processing.
 * Webhook controller adds jobs here → worker picks them up.
 *
 * Job lifecycle:
 *   waiting → active → completed
 *                ↓
 *             failed → delayed (retry with backoff)
 *                ↓
 *          failed (permanent — after maxAttempts)
 *
 * Retry schedule (exponential backoff, delay=5000ms):
 *   Attempt 1 → immediate
 *   Attempt 2 → wait 5s
 *   Attempt 3 → wait 10s
 *   → moved to failed state
 */

const QUEUE_NAME = config.queue.name;

// ── Queue instance ────────────────────────────────────────────────────
const orderQueue = new Queue(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: config.queue.maxAttempts,   // default: 3
    backoff: {
      type:  'exponential',
      delay: config.queue.backoffDelay,   // default: 5000ms
    },
    removeOnComplete: { count: 100 },     // keep last 100 completed in Redis
    removeOnFail:     { count: 200 },     // keep last 200 failed for inspection
  },
});

// ── Queue-level error handler ─────────────────────────────────────────
orderQueue.on('error', (err) => {
  logger.error('Queue connection error', { error: err.message });
});

// ── QueueEvents — listen to job lifecycle events ──────────────────────
// QueueEvents uses a SEPARATE Redis connection internally (BullMQ design)
const queueEvents = new QueueEvents(QUEUE_NAME, { connection });

queueEvents.on('waiting',   ({ jobId })         => logger.debug('Job waiting',   { jobId }));
queueEvents.on('active',    ({ jobId, prev })    => logger.debug('Job active',    { jobId, prev }));
queueEvents.on('completed', ({ jobId, returnvalue }) =>
  logger.info('Job completed', { jobId, result: returnvalue })
);
queueEvents.on('failed',    ({ jobId, failedReason }) =>
  logger.error('Job failed', { jobId, reason: failedReason })
);
queueEvents.on('delayed',   ({ jobId, delay })   => logger.warn('Job delayed (retry)', { jobId, delay }));
queueEvents.on('stalled',   ({ jobId })          => logger.warn('Job stalled',   { jobId }));
queueEvents.on('error',     (err)                => logger.error('QueueEvents error', { error: err.message }));

// ── Helper: get queue metrics ─────────────────────────────────────────
/**
 * Returns current counts for each job state.
 * Useful for health checks and monitoring.
 *
 * @returns {Promise<{waiting, active, completed, failed, delayed}>}
 */
async function getQueueMetrics() {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    orderQueue.getWaitingCount(),
    orderQueue.getActiveCount(),
    orderQueue.getCompletedCount(),
    orderQueue.getFailedCount(),
    orderQueue.getDelayedCount(),
  ]);
  return { waiting, active, completed, failed, delayed };
}

// ── Helper: add order job ─────────────────────────────────────────────
/**
 * Add an order processing job to the queue.
 * Wraps orderQueue.add() with consistent options + logging.
 *
 * @param {Object} payload
 * @param {number} payload.shopifyOrderId
 * @param {string} payload.customerEmail
 * @param {number} payload.totalPrice
 * @param {Array}  payload.lineItems
 * @returns {Promise<Job>}
 */
async function addOrderJob(payload) {
  const job = await orderQueue.add('process-order', payload, {
    // jobId dedup — BullMQ won't add a second job with the same ID
    // if one is already waiting/active
    jobId: `order-${payload.shopifyOrderId}`,
  });

  logger.info('Order job added to queue', {
    jobId:          job.id,
    shopifyOrderId: payload.shopifyOrderId,
    queueName:      QUEUE_NAME,
  });

  return job;
}

module.exports = { orderQueue, queueEvents, QUEUE_NAME, getQueueMetrics, addOrderJob };

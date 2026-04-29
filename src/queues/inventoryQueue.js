const { Queue, QueueEvents } = require('bullmq');
const connection = require('./connection');
const config     = require('../config');
const logger     = require('../utils/logger');

/**
 * Inventory Processing Queue
 *
 * Separate from the order queue — failures in one don't block the other.
 * Lower throughput expected (inventory updates are less frequent than orders).
 *
 * Jobs added by:   inventoryController.js
 * Jobs consumed by: src/workers/inventoryWorker.js
 *
 * Job payload shape:
 * {
 *   sku:        string,   // e.g. "ABC-123"
 *   quantity:   number,   // absolute quantity to set (not delta)
 *   locationId: string|null  // optional Shopify location GID override
 * }
 */

const INVENTORY_QUEUE_NAME = 'inventory-processing';

const inventoryQueue = new Queue(INVENTORY_QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: config.queue.maxAttempts,
    backoff: {
      type:  'exponential',
      delay: config.queue.backoffDelay,
    },
    removeOnComplete: { count: 50 },
    removeOnFail:     { count: 100 },
  },
});

inventoryQueue.on('error', (err) => {
  logger.error('Inventory queue error', { error: err.message });
});

// QueueEvents for lifecycle logging
const inventoryQueueEvents = new QueueEvents(INVENTORY_QUEUE_NAME, { connection });

inventoryQueueEvents.on('completed', ({ jobId }) =>
  logger.info('Inventory job completed', { jobId })
);
inventoryQueueEvents.on('failed', ({ jobId, failedReason }) =>
  logger.error('Inventory job failed', { jobId, reason: failedReason })
);
inventoryQueueEvents.on('delayed', ({ jobId, delay }) =>
  logger.warn('Inventory job delayed (retry)', { jobId, delay })
);
inventoryQueueEvents.on('error', (err) =>
  logger.error('Inventory QueueEvents error', { error: err.message })
);

module.exports = { inventoryQueue, INVENTORY_QUEUE_NAME };

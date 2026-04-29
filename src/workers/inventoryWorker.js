const { Worker }               = require('bullmq');
const connection               = require('../queues/connection');
const { INVENTORY_QUEUE_NAME } = require('../queues/inventoryQueue');
const config                   = require('../config');
const OrderItem                = require('../models/OrderItem');
const logger                   = require('../utils/logger');

// Use mock in dev mode, real service in production
const { getInventoryDetails, setInventoryQuantity } =
  config.shopify.useMock
    ? require('../services/__mocks__/shopifyInventoryService')
    : require('../services/shopifyInventoryService');

/**
 * Inventory update job processor.
 *
 * Flow:
 *  1. SKU → find variant_id in our DB (from enriched order_items)
 *  2. variant_id → get inventoryItemId + locationId from Shopify GraphQL
 *  3. Set absolute inventory quantity via Shopify GraphQL mutation
 *
 * Why DB lookup first?
 *  We store variant_sku in order_items after GraphQL enrichment.
 *  This avoids an extra Shopify API call to search by SKU.
 *  If SKU not in DB yet (new product, never ordered), job fails with clear message.
 */
async function processInventoryJob(job) {
  const { sku, quantity, locationId: overrideLocationId } = job.data;

  logger.info('Processing inventory update job', {
    jobId:    job.id,
    sku,
    quantity,
    attempt:  job.attemptsMade + 1,
    maxAttempts: job.opts.attempts,
  });

  // ── Step 1: SKU → variant_id from our DB ─────────────────────────
  await job.updateProgress(10);

  const itemRecord = await OrderItem.findVariantBySku(sku);

  if (!itemRecord) {
    // SKU not in our DB — this product has never been ordered through our system
    // We can't map it to a Shopify variant without an extra API call
    const errMsg = `SKU "${sku}" not found in order_items. ` +
      `Ensure this product has been ordered at least once so the variant_sku is stored.`;
    logger.error('SKU not found in local DB', { sku });
    throw new Error(errMsg);
  }

  const variantId = itemRecord.variant_id;
  logger.info('SKU mapped to variant', { sku, variantId });

  await job.updateProgress(33);

  // ── Step 2: Get inventoryItemId + locationId from Shopify ─────────
  const { inventoryItemId, locationId } = await getInventoryDetails(
    variantId,
    overrideLocationId
  );

  const finalLocationId = overrideLocationId || locationId;

  logger.info('Inventory details fetched from Shopify', {
    variantId,
    inventoryItemId,
    locationId: finalLocationId,
  });

  await job.updateProgress(66);

  // ── Step 3: Set inventory quantity on Shopify ─────────────────────
  const result = await setInventoryQuantity({
    inventoryItemId,
    locationId: finalLocationId,
    quantity,
  });

  // ── Step 4: Update our DB to reflect the synced quantity ──────────
  // This keeps GET /orders/:id in sync — synced_quantity shows what
  // was last pushed to Shopify, separate from the original order quantity.
  const rowsUpdated = await OrderItem.updateSyncedQuantity(sku, quantity);
  logger.info('Local DB synced_quantity updated', { sku, quantity, rowsUpdated });

  await job.updateProgress(100);

  logger.info('Inventory update complete ✅', {
    sku,
    quantity,
    variantId,
    inventoryItemId,
  });

  return { sku, quantity, variantId, inventoryItemId, result };
}

// ── Worker instance ───────────────────────────────────────────────────
const inventoryWorker = new Worker(
  INVENTORY_QUEUE_NAME,
  processInventoryJob,
  {
    connection,
    concurrency:     3,      // Lower than order worker — Shopify API rate limits
    lockDuration:    30000,
    stalledInterval: 30000,
    maxStalledCount: 1,
  }
);

// ── Event listeners ───────────────────────────────────────────────────
inventoryWorker.on('completed', (job, result) => {
  logger.info('Inventory job completed', {
    jobId:    job.id,
    sku:      result?.sku,
    quantity: result?.quantity,
  });
});

inventoryWorker.on('failed', (job, err) => {
  const isFinalAttempt = job?.attemptsMade >= (job?.opts?.attempts ?? config.queue.maxAttempts);

  logger.error('Inventory job failed', {
    jobId:          job?.id,
    sku:            job?.data?.sku,
    attempt:        job?.attemptsMade,
    maxAttempts:    job?.opts?.attempts,
    isFinalAttempt,
    error:          err.message,
  });

  if (isFinalAttempt) {
    logger.error('🚨 Inventory update permanently failed — manual intervention required', {
      jobId:    job.id,
      sku:      job.data?.sku,
      quantity: job.data?.quantity,
      error:    err.message,
    });
  }
});

inventoryWorker.on('progress', (job, progress) => {
  logger.debug('Inventory job progress', { jobId: job.id, progress: `${progress}%` });
});

inventoryWorker.on('stalled', (jobId) => {
  logger.warn('Inventory job stalled', { jobId });
});

inventoryWorker.on('error', (err) => {
  logger.error('Inventory worker error', { error: err.message });
});

module.exports = { inventoryWorker };

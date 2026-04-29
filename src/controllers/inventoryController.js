const { validateInventoryWebhook } = require('../validators/inventoryWebhookValidator');
const { inventoryQueue }           = require('../queues/inventoryQueue');
const logger                       = require('../utils/logger');

/**
 * POST /webhook/inventory-update
 *
 * Receives inventory update from a third-party system (ERP, WMS, etc.)
 * and queues it for async processing.
 *
 * Flow:
 *  1. Validate payload (sku + quantity required)
 *  2. Push to inventoryQueue (non-blocking)
 *  3. Return 200 immediately
 *
 * Why no idempotency DB check here?
 *  Inventory updates are idempotent by nature — setting quantity to 25
 *  twice gives the same result. We use jobId deduplication in the queue
 *  to prevent rapid-fire duplicate updates within a 10-second window.
 */
async function handleInventoryUpdate(req, res) {
  // ── Step 1: Validate ──────────────────────────────────────────────
  let payload;
  try {
    payload = validateInventoryWebhook(req.body);
  } catch (err) {
    logger.warn('Inventory webhook validation failed', { error: err.message });
    return res.status(422).json({ error: err.message });
  }

  const { sku, quantity, location_id } = payload;

  // ── Step 2: Push to queue ─────────────────────────────────────────
  try {
    // jobId deduplication: same SKU within a 10-second window = one job only
    // Prevents rapid-fire duplicate updates from the same third-party system
    const windowKey = Date.now() - (Date.now() % 10000); // 10s bucket
    const jobId     = `inventory:${sku}:${windowKey}`;

    await inventoryQueue.add(
      'update-inventory',
      { sku, quantity, locationId: location_id || null },
      {
        jobId,
        attempts: 3,
        backoff:  { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 50 },
        removeOnFail:     { count: 100 },
      }
    );

    logger.info('Inventory update job queued', { sku, quantity, jobId });
  } catch (err) {
    // BullMQ throws if jobId already exists — that's fine, it means dedup worked
    if (err.message?.includes('already exists')) {
      logger.info('Inventory update deduplicated (same SKU within 10s window)', { sku });
      return res.status(200).json({ status: 'deduplicated', sku, quantity });
    }

    logger.error('Failed to queue inventory update', { error: err.message, sku });
    return res.status(500).json({ error: 'Failed to queue inventory update' });
  }

  // ── Step 3: Return 200 immediately ───────────────────────────────
  return res.status(200).json({ status: 'queued', sku, quantity });
}

module.exports = { handleInventoryUpdate };

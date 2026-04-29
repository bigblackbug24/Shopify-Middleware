const { validateOrderWebhook }  = require('../validators/orderWebhookValidator');
const OrderWebhookDTO           = require('../dtos/OrderWebhookDTO');
const Order                     = require('../models/Order');
const { addOrderJob }           = require('../queues/orderQueue');
const logger                    = require('../utils/logger');

/**
 * POST /webhook/order-created
 *
 * Flow:
 *  1. Validate payload shape (Joi)
 *  2. Map to DTO
 *  3. Idempotency check — already processed?
 *  4. Push job to queue (non-blocking)
 *  5. Return 200 immediately — never block Shopify
 *
 * Shopify expects a 200 within 5 seconds or it will retry.
 * We respond in milliseconds by offloading work to the queue.
 */
async function handleOrderCreated(req, res) {
  // ── Step 1: Validate raw payload ─────────────────────────────────
  let validatedPayload;
  try {
    validatedPayload = validateOrderWebhook(req.body);
  } catch (err) {
    logger.warn('Webhook payload validation failed', { error: err.message });
    return res.status(422).json({ error: err.message });
  }

  // ── Step 2: Map to clean DTO ──────────────────────────────────────
  const dto = new OrderWebhookDTO(validatedPayload);

  if (!dto.isValid()) {
    logger.warn('DTO validation failed after mapping', { shopifyOrderId: dto.shopifyOrderId });
    return res.status(422).json({ error: 'Invalid order data' });
  }

  const { shopifyOrderId, customerEmail, totalPrice, lineItems } = dto;

  // ── Step 3: Idempotency check ─────────────────────────────────────
  // If this order was already queued/processed, silently acknowledge.
  // Shopify WILL send duplicate webhooks — this is expected behaviour.
  try {
    const exists = await Order.existsByShopifyId(shopifyOrderId);
    if (exists) {
      logger.info('Duplicate webhook received — skipping', { shopifyOrderId });
      return res.status(200).json({ status: 'duplicate', shopifyOrderId });
    }
  } catch (err) {
    logger.error('Idempotency check failed', { error: err.message, shopifyOrderId });
    return res.status(500).json({ error: 'Internal error during idempotency check' });
  }

  // ── Step 4: Push to queue ─────────────────────────────────────────
  // DO NOT await the processing here — just enqueue and return.
  // Use dto.toJSON() — strips class methods, only plain data in Redis.
  try {
    await addOrderJob(dto.toJSON());
    logger.info('Order job queued successfully', { shopifyOrderId, customerEmail });
  } catch (err) {
    logger.error('Failed to push job to queue', { error: err.message, shopifyOrderId });
    return res.status(500).json({ error: 'Failed to queue order for processing' });
  }

  // ── Step 5: Return 200 immediately ───────────────────────────────
  return res.status(200).json({ status: 'queued', shopifyOrderId });
}

module.exports = { handleOrderCreated };

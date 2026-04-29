const { Worker }                                    = require('bullmq');
const connection                                    = require('../queues/connection');
const { QUEUE_NAME }                                = require('../queues/orderQueue');
const config                                        = require('../config');
const Order                                         = require('../models/Order');
const OrderItem                                     = require('../models/OrderItem');
const { fetchProductDetails, fetchMultipleProducts } = require('../services/shopifyGraphqlService');
const logger                                        = require('../utils/logger');
const db                                            = require('../models/db');

// ─────────────────────────────────────────────────────────────────────
// Job Processor
// Called by BullMQ for every job pulled from the queue.
// Throwing an error triggers a retry (up to config.queue.maxAttempts).
// ─────────────────────────────────────────────────────────────────────
async function processOrderJob(job) {
  const { shopifyOrderId, customerEmail, totalPrice, lineItems } = job.data;

  logger.info('Processing order job', {
    jobId:         job.id,
    shopifyOrderId,
    customerEmail,
    itemCount:     lineItems.length,
    attempt:       job.attemptsMade + 1,
    maxAttempts:   job.opts.attempts,
  });

  // ── Step 1: Save order + items to DB (atomic transaction) ─────────
  // If this fails with ER_DUP_ENTRY it means a previous retry already
  // inserted the row — we recover gracefully instead of crashing.
  let orderId;

  try {
    await db.transaction(async (trx) => {
      // Use Order.create() model method — keeps DB logic in one place
      orderId = await Order.create(
        { shopifyOrderId, customerEmail, totalPrice, status: 'processing' },
        trx
      );

      // Bulk insert all line items in the same transaction
      await OrderItem.bulkCreate(orderId, lineItems, trx);
    });

    logger.info('Order + items saved to DB', { orderId, shopifyOrderId });

  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      // Race condition: two webhooks arrived simultaneously and both
      // passed the idempotency check before either inserted.
      // The second one hits ER_DUP_ENTRY here — recover by finding
      // the existing row and continuing with enrichment.
      logger.warn('ER_DUP_ENTRY — order already in DB, recovering', { shopifyOrderId });
      const existing = await Order.findByShopifyId(shopifyOrderId);
      if (!existing) {
        throw new Error(`ER_DUP_ENTRY but order not found for shopifyOrderId=${shopifyOrderId}`);
      }
      orderId = existing.id;
    } else {
      // Unknown DB error — mark order as failed if we have an orderId,
      // then re-throw so BullMQ retries the job.
      logger.error('DB transaction failed', { error: err.message, code: err.code, shopifyOrderId });
      throw err;
    }
  }

  // Update progress — visible in Bull Board
  await job.updateProgress(33);

  // ── Step 2: Enrich line items via Shopify GraphQL ────────────────
  // Strategy:
  //  - 1 item  → fetchProductDetails (single query)
  //  - 2+ items → fetchMultipleProducts (batch query — 1 API call total)
  //
  // GraphQL failures are NON-FATAL — a product lookup failure should
  // not prevent the order from being saved. We log and continue.
  const enrichedProducts  = [];
  const failedEnrichments = [];

  // Deduplicate product IDs — same product can appear in multiple line items
  const uniqueProductIds = [
    ...new Set(lineItems.map((item) => String(item.productId || item.product_id))),
  ];

  // Build a productId → enriched data map
  let productDataMap = new Map();

  try {
    if (uniqueProductIds.length === 1) {
      // Single product — use simple query
      const productId   = uniqueProductIds[0];
      const productData = await fetchProductDetails(productId);
      productDataMap.set(productId, productData);
    } else {
      // Multiple products — batch query (1 API call instead of N)
      productDataMap = await fetchMultipleProducts(uniqueProductIds);
    }
  } catch (err) {
    // Batch fetch failed entirely — fall back to individual fetches
    logger.warn('Batch GraphQL fetch failed — falling back to individual fetches', {
      error: err.message,
      orderId,
    });
    for (const productId of uniqueProductIds) {
      try {
        const productData = await fetchProductDetails(productId);
        productDataMap.set(productId, productData);
      } catch (singleErr) {
        logger.warn('Individual GraphQL fetch failed', { productId, error: singleErr.message });
      }
    }
  }

  // Apply enriched data to each line item
  for (const item of lineItems) {
    const productId  = String(item.productId || item.product_id);
    const productData = productDataMap.get(productId);

    if (!productData) {
      failedEnrichments.push({ productId, error: 'No data returned from GraphQL' });
      logger.warn('No GraphQL data for product — skipping enrichment', { orderId, productId });
      continue;
    }

    try {
      await OrderItem.updateEnrichedData(orderId, productId, {
        product_title: productData.title,
        variant_sku:   productData.variantSku,
        variant_price: productData.variantPrice,
      });

      enrichedProducts.push({ productId, title: productData.title });

      logger.info('Product enriched via GraphQL', {
        orderId,
        productId,
        title:        productData.title,
        variantPrice: productData.variantPrice,
        vendor:       productData.vendor,
      });
    } catch (err) {
      failedEnrichments.push({ productId, error: err.message });
      logger.warn('Failed to save enriched data to DB', { orderId, productId, error: err.message });
    }
  }

  await job.updateProgress(66);

  // ── Step 3: Mark order as completed ──────────────────────────────
  await Order.updateStatus(orderId, 'completed');
  await job.updateProgress(100);

  logger.info('Order processing complete ✅', {
    orderId,
    shopifyOrderId,
    enriched:       enrichedProducts.length,
    enrichFailed:   failedEnrichments.length,
    totalItems:     lineItems.length,
  });

  // Return value is stored in job.returnvalue — visible in Bull Board
  return {
    orderId,
    shopifyOrderId,
    enrichedProducts,
    failedEnrichments,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Worker Instance
// ─────────────────────────────────────────────────────────────────────
const orderWorker = new Worker(QUEUE_NAME, processOrderJob, {
  connection,
  concurrency:     config.queue.concurrency,  // parallel jobs (default: 5)

  // Stalled job detection — handles worker crash mid-job
  lockDuration:    30000,  // Worker holds job lock for 30s
  stalledInterval: 30000,  // Check for stalled jobs every 30s
  maxStalledCount: 1,      // Re-queue once on stall, then move to failed
});

// ─────────────────────────────────────────────────────────────────────
// Worker Event Listeners
// ─────────────────────────────────────────────────────────────────────

orderWorker.on('completed', (job, result) => {
  logger.info('Job completed', {
    jobId:          job.id,
    orderId:        result?.orderId,
    shopifyOrderId: result?.shopifyOrderId,
    enriched:       result?.enrichedProducts?.length,
  });
});

orderWorker.on('failed', async (job, err) => {
  const isFinalAttempt = job?.attemptsMade >= (job?.opts?.attempts ?? config.queue.maxAttempts);

  logger.error('Job failed', {
    jobId:          job?.id,
    shopifyOrderId: job?.data?.shopifyOrderId,
    attempt:        job?.attemptsMade,
    maxAttempts:    job?.opts?.attempts,
    isFinalAttempt,
    error:          err.message,
  });

  // On final failure — update order status to 'failed' in DB
  // so it's visible in any admin dashboard
  if (isFinalAttempt && job?.data?.shopifyOrderId) {
    try {
      const order = await Order.findByShopifyId(job.data.shopifyOrderId);
      if (order) {
        await Order.updateStatus(order.id, 'failed');
        logger.error('Order marked as failed in DB', {
          orderId:        order.id,
          shopifyOrderId: job.data.shopifyOrderId,
        });
      }
    } catch (dbErr) {
      logger.error('Could not mark order as failed in DB', { error: dbErr.message });
    }

    // ── Alert hook (extend this for Slack / PagerDuty / email) ──────
    logger.error('🚨 ALERT: Job permanently failed — manual intervention required', {
      jobId:          job.id,
      shopifyOrderId: job.data.shopifyOrderId,
      customerEmail:  job.data.customerEmail,
      error:          err.message,
    });
  }
});

orderWorker.on('progress', (job, progress) => {
  logger.debug('Job progress', { jobId: job.id, progress: `${progress}%` });
});

orderWorker.on('stalled', (jobId) => {
  logger.warn('Job stalled — worker may have crashed mid-job', { jobId });
});

orderWorker.on('error', (err) => {
  logger.error('Worker-level error', { error: err.message });
});

orderWorker.on('active', (job) => {
  logger.debug('Job picked up by worker', {
    jobId:          job.id,
    shopifyOrderId: job.data?.shopifyOrderId,
  });
});

module.exports = { orderWorker };

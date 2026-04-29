const Bottleneck = require('bottleneck');
const logger     = require('../utils/logger');

/**
 * Shopify Admin API Rate Limiter — Bottleneck (leaky bucket)
 *
 * WHY this exists:
 *  shopifyClient.js handles a single 429 with one retry.
 *  But at scale (many orders processed concurrently), we can hit
 *  the rate limit repeatedly. Bottleneck proactively throttles
 *  requests BEFORE they get rejected.
 *
 * Shopify rate limits:
 *  ┌──────────────┬─────────────┬──────────────────┐
 *  │ Plan         │ Bucket Size │ Refill Rate       │
 *  ├──────────────┼─────────────┼──────────────────┤
 *  │ Basic        │ 40 calls    │ 2 calls/second    │
 *  │ Shopify      │ 40 calls    │ 2 calls/second    │
 *  │ Advanced     │ 80 calls    │ 4 calls/second    │
 *  │ Plus         │ 80 calls    │ 4 calls/second    │
 *  │ GraphQL      │ 1000 pts    │ 50 pts/second     │
 *  └──────────────┴─────────────┴──────────────────┘
 *
 * Our settings (conservative — works on all plans):
 *  - reservoir: 35          → start with 35 tokens (leave 5 buffer)
 *  - refreshAmount: 2       → refill 2 tokens
 *  - refreshInterval: 1000  → every 1 second
 *  - maxConcurrent: 2       → max 2 parallel requests
 *  - minTime: 500           → min 500ms between requests
 *
 * Usage:
 *   const result = await shopifyLimiter.schedule(() => shopifyClient.post(...));
 */
const shopifyLimiter = new Bottleneck({
  reservoir:              35,    // Initial token count
  reservoirRefreshAmount: 2,     // Tokens added per interval
  reservoirRefreshInterval: 1000, // Refill every 1 second
  maxConcurrent: 2,              // Max parallel Shopify API calls
  minTime:       500,            // Min 500ms between any two requests
});

// ── Event listeners ───────────────────────────────────────────────────

shopifyLimiter.on('depleted', (empty) => {
  if (empty) {
    logger.warn('Shopify rate limiter bucket fully depleted — requests queuing', {
      queued: shopifyLimiter.queued(),
    });
  }
});

shopifyLimiter.on('error', (err) => {
  logger.error('Shopify rate limiter error', { error: err.message });
});

shopifyLimiter.on('failed', async (err, jobInfo) => {
  // Called when a scheduled job throws — retry after 1s
  logger.warn('Shopify rate limiter job failed — will retry', {
    error:   err.message,
    retries: jobInfo.retryCount,
  });
  if (jobInfo.retryCount < 2) return 1000; // retry after 1s
});

// ── Helper: get current limiter stats ────────────────────────────────
async function getLimiterStats() {
  return {
    running:   shopifyLimiter.running(),
    queued:    shopifyLimiter.queued(),
    reservoir: await shopifyLimiter.currentReservoir(),
  };
}

module.exports = { shopifyLimiter, getLimiterStats };

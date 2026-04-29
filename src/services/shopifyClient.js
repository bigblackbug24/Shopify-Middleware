const axios  = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Pre-configured Axios instance for Shopify Admin API.
 *
 * What this does:
 *  - Base URL baked in (store domain + API version from config)
 *  - Auth header baked in (X-Shopify-Access-Token)
 *  - 10s timeout — workers never hang forever on a slow API
 *  - Request interceptor — logs every outgoing call (debug level)
 *  - Response interceptor — logs rate limit bucket + handles 429
 *
 * Rate limit handling:
 *  Shopify uses a leaky bucket model. When bucket is empty, it
 *  returns 429 with a Retry-After header. We wait that duration
 *  and retry ONCE automatically. For sustained high volume, use
 *  the Bottleneck rate limiter in shopifyRateLimiter.js (Module 08).
 */
const shopifyClient = axios.create({
  baseURL: config.shopify.adminApiBaseUrl,
  headers: {
    'Content-Type':           'application/json',
    'X-Shopify-Access-Token': config.shopify.accessToken,
  },
  timeout: 10000, // 10 seconds
});

// ── Request interceptor — log every outgoing Shopify API call ─────────
shopifyClient.interceptors.request.use(
  (req) => {
    logger.debug('Shopify API → request', {
      method: req.method?.toUpperCase(),
      url:    req.url,
    });
    return req;
  },
  (err) => {
    logger.error('Shopify API → request setup failed', { error: err.message });
    return Promise.reject(err);
  }
);

// ── Response interceptor — rate limit logging + 429 retry ────────────
shopifyClient.interceptors.response.use(
  (res) => {
    // Shopify sends X-Shopify-Shop-Api-Call-Limit: "used/total"
    // e.g. "32/40" — log it at debug so we can spot approaching limits
    const callLimit = res.headers['x-shopify-shop-api-call-limit'];
    if (callLimit) {
      const [used, total] = callLimit.split('/').map(Number);
      const pct = Math.round((used / total) * 100);

      if (pct >= 80) {
        logger.warn('Shopify API call limit approaching', { callLimit, pct: `${pct}%` });
      } else {
        logger.debug('Shopify API call limit', { callLimit });
      }
    }
    return res;
  },
  async (err) => {
    const status = err.response?.status;

    // 429 — Rate limited. Wait for Retry-After then retry once.
    if (status === 429) {
      const retryAfter = parseInt(err.response.headers['retry-after'] || '2', 10);
      logger.warn('Shopify rate limit hit — waiting before retry', { retryAfterSeconds: retryAfter });
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      return shopifyClient.request(err.config);
    }

    // 401 — Bad access token
    if (status === 401) {
      logger.error('Shopify API → 401 Unauthorized. Check SHOPIFY_ACCESS_TOKEN in .env');
    }

    // 402 — Store on a plan that doesn't support this API
    if (status === 402) {
      logger.error('Shopify API → 402 Payment Required. Store plan may not support this API.');
    }

    // 503 — Shopify is down or store is paused
    if (status === 503) {
      logger.warn('Shopify API → 503 Service Unavailable. Shopify may be down.');
    }

    logger.error('Shopify API → request failed', {
      status,
      url:     err.config?.url,
      message: err.message,
    });

    return Promise.reject(err);
  }
);

module.exports = shopifyClient;

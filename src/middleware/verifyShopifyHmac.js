const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * Middleware — verifies Shopify webhook HMAC signature.
 *
 * Shopify signs every webhook with:
 *   HMAC = base64( HMAC_SHA256( rawBody, SHOPIFY_WEBHOOK_SECRET ) )
 * and sends it in the X-Shopify-Hmac-Sha256 header.
 *
 * CRITICAL: Must run BEFORE express.json() on webhook routes,
 * because we need the raw body bytes — not the parsed JSON.
 *
 * Dev bypass: set SKIP_HMAC_VERIFY=true in .env for local testing
 * without a real Shopify store.
 */
module.exports = function verifyShopifyHmac(req, res, next) {
  // Dev bypass — only allowed in non-production
  if (process.env.SKIP_HMAC_VERIFY === 'true' && process.env.NODE_ENV !== 'production') {
    logger.warn('HMAC verification SKIPPED — dev mode only');
    return next();
  }

  const hmacHeader = req.headers['x-shopify-hmac-sha256'];

  if (!hmacHeader) {
    logger.warn('Webhook rejected: missing X-Shopify-Hmac-Sha256 header', {
      ip: req.ip,
    });
    return res.status(401).json({ error: 'Missing HMAC header' });
  }

  if (!req.rawBody) {
    logger.error('rawBody not available — check app.js raw body middleware setup');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) {
    logger.error('SHOPIFY_WEBHOOK_SECRET not set in environment');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // Compute expected HMAC from raw body
  const computedHmac = crypto
    .createHmac('sha256', secret)
    .update(req.rawBody, 'utf8')
    .digest('base64');

  // timingSafeEqual prevents timing attacks
  const trusted  = Buffer.from(hmacHeader,    'base64');
  const computed = Buffer.from(computedHmac,  'base64');

  const isValid =
    trusted.length === computed.length &&
    crypto.timingSafeEqual(trusted, computed);

  if (!isValid) {
    logger.warn('Webhook rejected: invalid HMAC signature', { ip: req.ip });
    return res.status(401).json({ error: 'Invalid HMAC signature' });
  }

  next();
};

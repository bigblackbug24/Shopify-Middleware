const express                        = require('express');
const verifyShopifyHmac              = require('../middleware/verifyShopifyHmac');
const { handleOrderCreated }         = require('../controllers/webhookController');
const { handleInventoryUpdate }      = require('../controllers/inventoryController');
const asyncHandler                   = require('../middleware/asyncHandler');

const router = express.Router();

/**
 * POST /webhook/order-created
 *
 * Inbound: Shopify → Our system
 * Secured with Shopify HMAC signature verification.
 */
router.post(
  '/order-created',
  verifyShopifyHmac,
  asyncHandler(handleOrderCreated)
);

/**
 * POST /webhook/inventory-update
 *
 * Outbound trigger: Third-party system → Our system → Shopify
 *
 * Receives inventory updates from ERP/WMS systems and queues
 * them for async processing via Shopify GraphQL mutation.
 *
 * Security note: Add your own auth middleware here for production.
 * e.g. API key check, IP whitelist, or JWT verification.
 */
router.post(
  '/inventory-update',
  asyncHandler(handleInventoryUpdate)
);

module.exports = router;

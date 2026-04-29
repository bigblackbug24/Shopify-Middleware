const express      = require('express');
const Order        = require('../models/Order');
const OrderItem    = require('../models/OrderItem');
const asyncHandler = require('../middleware/asyncHandler');
const AppError     = require('../utils/AppError');

const router = express.Router();

/**
 * GET /orders
 * List all orders with optional filters.
 *
 * Query params:
 *   ?status=completed|pending|processing|failed
 *   ?email=customer@example.com
 *   ?limit=50
 *   ?offset=0
 */
router.get('/', asyncHandler(async (req, res) => {
  const { status, email, limit = 50, offset = 0 } = req.query;

  const orders = await Order.findAll({
    status,
    customerEmail: email,
    limit:  parseInt(limit,  10),
    offset: parseInt(offset, 10),
  });

  return res.json({
    count:  orders.length,
    orders,
  });
}));

/**
 * GET /orders/stats
 * Count of orders grouped by status — for dashboards.
 */
router.get('/stats', asyncHandler(async (req, res) => {
  const rows = await Order.countByStatus();

  const stats = rows.reduce((acc, row) => {
    acc[row.status] = parseInt(row.count, 10);
    return acc;
  }, {});

  return res.json({ stats });
}));

/**
 * GET /orders/:id
 * Get a single order by internal DB ID, including its line items.
 */
router.get('/:id', asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);

  if (isNaN(id)) {
    throw AppError.badRequest('Order ID must be a number');
  }

  const order = await Order.findById(id);

  if (!order) {
    throw AppError.notFound(`Order ${id} not found`);
  }

  const items = await OrderItem.findByOrderId(id);

  return res.json({ ...order, items });
}));

/**
 * GET /orders/shopify/:shopifyOrderId
 * Get an order by Shopify order ID, including its line items.
 */
router.get('/shopify/:shopifyOrderId', asyncHandler(async (req, res) => {
  const { shopifyOrderId } = req.params;

  const order = await Order.findByShopifyId(shopifyOrderId);

  if (!order) {
    throw AppError.notFound(`Order with Shopify ID ${shopifyOrderId} not found`);
  }

  const items = await OrderItem.findByOrderId(order.id);

  return res.json({ ...order, items });
}));

module.exports = router;

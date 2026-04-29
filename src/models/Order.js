const db = require('./db');

/**
 * Order model — all DB queries for the orders table.
 * All DB logic lives here — never write table queries in controllers/workers.
 */
class Order {
  static TABLE = 'orders';

  /**
   * Insert a new order row.
   * Throws ER_DUP_ENTRY if shopify_order_id already exists (idempotency).
   *
   * @param {Object} data
   * @param {number} data.shopifyOrderId
   * @param {string} data.customerEmail
   * @param {number} data.totalPrice
   * @param {string} [data.status='pending']
   * @param {Object} [trx] - Optional Knex transaction
   * @returns {Promise<number>} Inserted row ID
   */
  static async create(data, trx = db) {
    const [id] = await trx(this.TABLE).insert({
      shopify_order_id: data.shopifyOrderId,
      customer_email:   data.customerEmail,
      total_price:      data.totalPrice,
      status:           data.status || 'pending',
    });
    return id;
  }

  /**
   * Check if an order already exists by Shopify order ID.
   * Used for idempotency check in the webhook controller.
   *
   * @param {number} shopifyOrderId
   * @returns {Promise<boolean>}
   */
  static async existsByShopifyId(shopifyOrderId) {
    const row = await db(this.TABLE)
      .where('shopify_order_id', shopifyOrderId)
      .first('id');
    return !!row;
  }

  /**
   * Find an order by its Shopify order ID.
   * Used by worker to recover from ER_DUP_ENTRY on retry.
   *
   * @param {number} shopifyOrderId
   * @returns {Promise<Object|undefined>}
   */
  static async findByShopifyId(shopifyOrderId) {
    return db(this.TABLE)
      .where('shopify_order_id', shopifyOrderId)
      .first();
  }

  /**
   * Find an order by internal DB ID.
   *
   * @param {number} id
   * @returns {Promise<Object|undefined>}
   */
  static async findById(id) {
    return db(this.TABLE).where({ id }).first();
  }

  /**
   * Update order status.
   * Valid: 'pending' | 'processing' | 'completed' | 'failed'
   *
   * @param {number} id
   * @param {string} status
   * @returns {Promise<number>} Rows updated
   */
  static async updateStatus(id, status) {
    return db(this.TABLE).where({ id }).update({ status });
  }

  /**
   * Get all orders with optional filters — for admin/reporting.
   * BUG FIX: query chain must be built correctly (where returns same query).
   *
   * @param {Object}  opts
   * @param {string}  [opts.status]
   * @param {string}  [opts.customerEmail]
   * @param {number}  [opts.limit=50]
   * @param {number}  [opts.offset=0]
   * @returns {Promise<Array>}
   */
  static async findAll({ status, customerEmail, limit = 50, offset = 0 } = {}) {
    const query = db(this.TABLE)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);

    // Must reassign — Knex where() returns a new query builder
    if (status)        query.where({ status });
    if (customerEmail) query.where({ customer_email: customerEmail });

    return query;
  }

  /**
   * Count orders grouped by status — for dashboard metrics.
   *
   * @returns {Promise<Array<{status, count}>>}
   */
  static async countByStatus() {
    return db(this.TABLE)
      .select('status')
      .count('id as count')
      .groupBy('status');
  }
}

module.exports = Order;

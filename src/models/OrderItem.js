const db = require('./db');

/**
 * OrderItem model — all DB queries for the order_items table.
 */
class OrderItem {
  static TABLE = 'order_items';

  /**
   * Bulk insert all line items for an order.
   * Handles both DTO shape (productId/variantId) and
   * raw Shopify shape (product_id/variant_id).
   *
   * @param {number} orderId    - Internal DB order ID (orders.id)
   * @param {Array}  lineItems  - Line items from DTO or raw payload
   * @param {Object} [trx]      - Optional Knex transaction
   * @returns {Promise<Array>}
   */
  static async bulkCreate(orderId, lineItems, trx = db) {
    const rows = lineItems.map((item) => ({
      order_id:   orderId,
      // Support both DTO shape (camelCase) and raw Shopify shape (snake_case)
      product_id: String(item.productId  || item.product_id),
      variant_id: String(item.variantId  || item.variant_id),
      sku:        item.sku || null,   // from webhook payload directly
      quantity:   item.quantity,
      price:      parseFloat(item.price),
    }));

    return trx(this.TABLE).insert(rows);
  }

  /**
   * Update a single order item with enriched GraphQL data.
   * Called by worker after fetching product details from Shopify.
   *
   * @param {number} orderId
   * @param {string} productId
   * @param {Object} enrichedData
   * @param {string} [enrichedData.product_title]
   * @param {string} [enrichedData.variant_sku]
   * @param {string} [enrichedData.variant_price]
   * @returns {Promise<number>} Rows updated
   */
  static async updateEnrichedData(orderId, productId, enrichedData) {
    return db(this.TABLE)
      .where({ order_id: orderId, product_id: String(productId) })
      .update({
        product_title: enrichedData.product_title || null,
        variant_sku:   enrichedData.variant_sku   || null,
        variant_price: enrichedData.variant_price || null,
      });
  }

  /**
   * Get all items for a given order.
   *
   * @param {number} orderId
   * @returns {Promise<Array>}
   */
  static async findByOrderId(orderId) {
    return db(this.TABLE).where({ order_id: orderId });
  }

  /**
   * Find all orders containing a specific product — analytics query.
   *
   * @param {string} productId
   * @returns {Promise<Array>}
   */
  static async findByProductId(productId) {
    return db(this.TABLE)
      .where(`${this.TABLE}.product_id`, String(productId))
      .join('orders', 'order_items.order_id', 'orders.id')
      .select(
        'order_items.*',
        'orders.shopify_order_id',
        'orders.customer_email',
        'orders.status as order_status'
      );
  }

  /**
   * Find the most recent order_item record for a given SKU.
   * Used by inventory worker to map SKU → variant_id.
   *
   * Checks both the direct `sku` column (from webhook payload)
   * and `variant_sku` (enriched from GraphQL) for maximum coverage.
   *
   * @param {string} sku
   * @returns {Promise<Object|undefined>}
   */
  static async findVariantBySku(sku) {
    // Try direct sku column first (set at order time)
    const byDirectSku = await db(this.TABLE)
      .where({ sku: String(sku) })
      .orderBy('created_at', 'desc')
      .first('variant_id', 'product_id', 'sku', 'variant_sku');

    if (byDirectSku) return byDirectSku;

    // Fallback: try variant_sku (enriched from GraphQL)
    return db(this.TABLE)
      .where({ variant_sku: String(sku) })
      .orderBy('created_at', 'desc')
      .first('variant_id', 'product_id', 'sku', 'variant_sku');
  }
}

module.exports = OrderItem;

const db = require('./db');

/**
 * OrderItem model — all DB queries for the order_items table.
 */
class OrderItem {
  static TABLE = 'order_items';

  /**
   * Bulk insert all line items for an order.
   */
  static async bulkCreate(orderId, lineItems, trx = db) {
    const rows = lineItems.map((item) => ({
      order_id:   orderId,
      product_id: String(item.productId  || item.product_id),
      variant_id: String(item.variantId  || item.variant_id),
      sku:        item.sku || null,
      quantity:   item.quantity,
      price:      parseFloat(item.price),
    }));

    return trx(this.TABLE).insert(rows);
  }

  /**
   * Update enriched GraphQL data on order items.
   * Called by order worker after fetching product details.
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
   * Update synced_quantity for all order_items matching a SKU.
   *
   * Called by inventory worker AFTER successfully pushing the update to Shopify.
   * This keeps our DB in sync so GET /orders/:id shows the latest stock level.
   *
   * NOTE: We update synced_quantity — NOT quantity.
   *   quantity        = how many units the customer ordered (immutable)
   *   synced_quantity = current stock level we pushed to Shopify
   *
   * @param {string} sku      - SKU that was updated
   * @param {number} quantity - New stock level pushed to Shopify
   * @returns {Promise<number>} Number of rows updated
   */
  static async updateSyncedQuantity(sku, quantity) {
    return db(this.TABLE)
      .where(function () {
        this.where({ sku: String(sku) })
            .orWhere({ variant_sku: String(sku) });
      })
      .update({
        synced_quantity: quantity,
        synced_at:       db.fn.now(),
      });
  }

  /**
   * Get all items for a given order.
   */
  static async findByOrderId(orderId) {
    return db(this.TABLE).where({ order_id: orderId });
  }

  /**
   * Find all orders containing a specific product.
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
   * Checks direct sku column first, then variant_sku (enriched from GraphQL).
   */
  static async findVariantBySku(sku) {
    const byDirectSku = await db(this.TABLE)
      .where({ sku: String(sku) })
      .orderBy('created_at', 'desc')
      .first('variant_id', 'product_id', 'sku', 'variant_sku');

    if (byDirectSku) return byDirectSku;

    return db(this.TABLE)
      .where({ variant_sku: String(sku) })
      .orderBy('created_at', 'desc')
      .first('variant_id', 'product_id', 'sku', 'variant_sku');
  }
}

module.exports = OrderItem;

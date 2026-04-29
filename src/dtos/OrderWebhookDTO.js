/**
 * Data Transfer Object — maps raw Shopify webhook payload
 * to a clean, typed internal shape.
 *
 * WHY DTOs exist:
 *  Shopify can add/rename/remove fields at any time.
 *  Isolating the mapping here means ONE place to update
 *  when Shopify changes their payload structure.
 *
 *  Controllers and workers only ever see the clean DTO shape —
 *  never the raw Shopify payload.
 */
class OrderWebhookDTO {
  /**
   * @param {Object} raw - Raw Shopify webhook payload (req.body)
   */
  constructor(raw) {
    this.shopifyOrderId = raw.id;
    this.orderNumber    = raw.order_number   || null;
    this.customerEmail  = raw.email;
    this.totalPrice     = parseFloat(raw.total_price);
    this.currency       = raw.currency       || 'USD';
    this.createdAt      = raw.created_at     || new Date().toISOString();
    this.note           = raw.note           || null;
    this.tags           = raw.tags           || null;

    // Map line items — normalize both camelCase and snake_case field names
    this.lineItems = (raw.line_items || []).map((item) => ({
      productId: String(item.product_id),
      variantId: String(item.variant_id),
      sku:       item.sku   || null,
      quantity:  item.quantity,
      price:     parseFloat(item.price),
      title:     item.title || null,
    }));
  }

  /**
   * Static factory — create DTO from raw payload.
   * Cleaner than `new OrderWebhookDTO(raw)` at call sites.
   *
   * @param {Object} raw
   * @returns {OrderWebhookDTO}
   */
  static fromRaw(raw) {
    return new OrderWebhookDTO(raw);
  }

  /**
   * Sanity check after mapping.
   * Joi already validated the raw payload — this is a final safety net.
   *
   * @returns {boolean}
   */
  isValid() {
    return (
      !!this.shopifyOrderId &&
      !!this.customerEmail &&
      this.totalPrice >= 0 &&
      this.lineItems.length > 0
    );
  }

  /**
   * Convert to plain object for queue job payload.
   * Strips class methods — only data goes into Redis.
   *
   * @returns {Object}
   */
  toJSON() {
    return {
      shopifyOrderId: this.shopifyOrderId,
      orderNumber:    this.orderNumber,
      customerEmail:  this.customerEmail,
      totalPrice:     this.totalPrice,
      currency:       this.currency,
      createdAt:      this.createdAt,
      lineItems:      this.lineItems,
    };
  }
}

module.exports = OrderWebhookDTO;

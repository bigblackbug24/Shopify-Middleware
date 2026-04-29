/**
 * Migration 003 — Add sku column to order_items
 *
 * Assignment requires sku as a direct column on order_items.
 * Previously stored as variant_sku (enriched from GraphQL).
 * Now stored at insert time from the webhook payload directly.
 *
 * sku column:
 *  - Nullable — not all Shopify line items have a SKU set
 *  - Indexed  — inventory worker looks up variant_id by SKU
 */

exports.up = (knex) =>
  knex.schema.alterTable('order_items', (t) => {
    // Add sku column after variant_id
    t.string('sku', 255).nullable().after('variant_id');

    // Index for inventory worker SKU → variant_id lookup
    t.index('sku', 'idx_order_items_sku');
  });

exports.down = (knex) =>
  knex.schema.alterTable('order_items', (t) => {
    t.dropIndex('sku', 'idx_order_items_sku');
    t.dropColumn('sku');
  });

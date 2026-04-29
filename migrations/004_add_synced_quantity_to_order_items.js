/**
 * Migration 004 — Add synced_quantity to order_items
 *
 * WHY a separate column instead of updating quantity?
 *
 * order_items.quantity  = how many units the customer ORDERED (never changes)
 * order_items.synced_quantity = current stock level pushed to Shopify by inventory worker
 *
 * These are two different things. Overwriting quantity would lose
 * the original order data.
 *
 * synced_quantity is NULL until an inventory update is processed for that SKU.
 */

exports.up = (knex) =>
  knex.schema.alterTable('order_items', (t) => {
    t.integer('synced_quantity').unsigned().nullable().after('quantity')
      .comment('Stock level last synced to Shopify via inventory-update webhook');

    t.timestamp('synced_at').nullable().after('synced_quantity')
      .comment('When the inventory sync was last performed');
  });

exports.down = (knex) =>
  knex.schema.alterTable('order_items', (t) => {
    t.dropColumn('synced_quantity');
    t.dropColumn('synced_at');
  });

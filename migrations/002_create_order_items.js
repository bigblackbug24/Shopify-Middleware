/**
 * Migration 002 — Create order_items table
 *
 * One row per line item in an order.
 * FK to orders with CASCADE DELETE — delete order = delete its items.
 */

exports.up = (knex) =>
  knex.schema.createTable('order_items', (t) => {
    t.increments('id').unsigned().primary();

    // FK to orders.id
    t.integer('order_id').unsigned().notNullable();

    // Shopify IDs stored as VARCHAR — they use GID format in GraphQL
    // e.g. "gid://shopify/Product/123456789"
    t.string('product_id', 100).notNullable();
    t.string('variant_id', 100).notNullable();

    t.smallint('quantity').unsigned().notNullable();

    // DECIMAL not FLOAT — money values
    t.decimal('price', 10, 2).notNullable();

    // Optional enriched data from Shopify GraphQL (filled by worker)
    t.string('product_title', 500).nullable();
    t.string('variant_sku', 100).nullable();
    t.string('variant_price', 20).nullable();

    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    // ── Foreign Key ──────────────────────────────────────────────────
    t.foreign('order_id')
      .references('id')
      .inTable('orders')
      .onDelete('CASCADE');

    // ── Indexes ──────────────────────────────────────────────────────
    // JOIN performance — fetch all items for an order
    t.index('order_id', 'idx_order_items_order_id');

    // Analytics — "which orders contain this product?"
    t.index('product_id', 'idx_order_items_product_id');
  });

exports.down = (knex) => knex.schema.dropTableIfExists('order_items');

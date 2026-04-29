/**
 * Migration 001 — Create orders table
 *
 * orders table stores one row per Shopify order.
 * UNIQUE KEY on shopify_order_id = DB-level idempotency guarantee.
 */

exports.up = (knex) =>
  knex.schema.createTable('orders', (t) => {
    t.increments('id').unsigned().primary();

    // Shopify order ID — BIGINT because Shopify IDs exceed INT range
    t.bigInteger('shopify_order_id').unsigned().notNullable();

    t.string('customer_email', 255).notNullable();

    // DECIMAL not FLOAT — avoids floating point rounding errors on money
    t.decimal('total_price', 10, 2).notNullable();

    t.enu('status', ['pending', 'processing', 'completed', 'failed'])
      .notNullable()
      .defaultTo('pending');

    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at')
      .notNullable()
      .defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));

    // ── Indexes ──────────────────────────────────────────────────────
    // Core idempotency — same Shopify order cannot be inserted twice
    t.unique('shopify_order_id', { indexName: 'uq_shopify_order_id' });

    // Customer order history lookup
    t.index('customer_email', 'idx_customer_email');

    // Worker monitoring + dashboard queries
    t.index('status', 'idx_status');

    // Date-range reporting
    t.index('created_at', 'idx_created_at');
  });

exports.down = (knex) => knex.schema.dropTableIfExists('orders');

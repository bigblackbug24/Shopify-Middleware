/**
 * Shopify GraphQL Service
 *
 * USE_MOCK_SHOPIFY=true  → uses __mocks__ (no real store needed)
 * USE_MOCK_SHOPIFY=false → calls real Shopify Admin GraphQL API
 *
 * Both exports are identical in shape so the worker never needs
 * to know which one is active.
 */
if (process.env.USE_MOCK_SHOPIFY === 'true') {
  module.exports = require('./__mocks__/shopifyGraphqlService');
  return;
}

// ─────────────────────────────────────────────────────────────────────
// Real implementation — only loaded when USE_MOCK_SHOPIFY != true
// ─────────────────────────────────────────────────────────────────────

const shopifyClient              = require('./shopifyClient');
const { shopifyLimiter }         = require('./shopifyRateLimiter');
const { withShopifyRetry }       = require('../utils/retry');
const logger                     = require('../utils/logger');

const GRAPHQL_ENDPOINT = '/graphql.json';

/**
 * Convert numeric Shopify product ID → GraphQL Global ID.
 * Shopify GraphQL requires: gid://shopify/Product/123456
 *
 * @param {string|number} productId
 * @returns {string}
 */
function toGid(productId) {
  if (String(productId).startsWith('gid://')) return String(productId);
  return `gid://shopify/Product/${productId}`;
}

/**
 * Execute a raw GraphQL query against Shopify Admin API.
 *
 * Key gotcha: GraphQL errors come back with HTTP 200.
 * We must check the `errors` array manually — HTTP status alone is not enough.
 *
 * @param {string} query
 * @param {Object} variables
 * @returns {Promise<Object>} data field from response
 * @throws {Error} on HTTP error or GraphQL errors
 */
async function runQuery(query, variables = {}) {
  // Rate limiter wraps the actual HTTP call
  // Bottleneck queues requests when bucket is low
  const response = await shopifyLimiter.schedule(() =>
    withShopifyRetry(
      () => shopifyClient.post(GRAPHQL_ENDPOINT, { query, variables }),
      'Shopify GraphQL query'
    )
  );
  const { data, errors, extensions } = response.data;

  // Log GraphQL query cost — helps monitor rate limit consumption
  if (extensions?.cost) {
    const { requestedQueryCost, actualQueryCost, throttleStatus } = extensions.cost;
    logger.debug('Shopify GraphQL query cost', {
      requested:         requestedQueryCost,
      actual:            actualQueryCost,
      currentlyAvailable: throttleStatus?.currentlyAvailable,
      restoreRate:       throttleStatus?.restoreRate,
    });

    // Warn if we're burning through the bucket fast
    if (throttleStatus?.currentlyAvailable < 100) {
      logger.warn('Shopify GraphQL throttle bucket running low', {
        available: throttleStatus.currentlyAvailable,
      });
    }
  }

  // GraphQL errors — HTTP 200 but errors array is populated
  if (errors && errors.length > 0) {
    const msg = errors.map((e) => e.message).join(' | ');
    throw new Error(`Shopify GraphQL error: ${msg}`);
  }

  return data;
}

// ─────────────────────────────────────────────────────────────────────
// Query 1: Single Product
// ─────────────────────────────────────────────────────────────────────

const GET_PRODUCT_QUERY = `
  query GetProduct($id: ID!) {
    product(id: $id) {
      id
      title
      status
      vendor
      productType
      variants(first: 1) {
        edges {
          node {
            id
            price
            compareAtPrice
            sku
            inventoryQuantity
          }
        }
      }
    }
  }
`;

/**
 * Fetch product details from Shopify Admin GraphQL API.
 *
 * @param {string|number} productId - Shopify numeric product ID
 * @returns {Promise<{
 *   title, status, vendor, productType,
 *   variantPrice, variantSku, compareAtPrice, inventoryQuantity
 * }>}
 */
async function fetchProductDetails(productId) {
  const gid = toGid(productId);

  logger.debug('Fetching product from Shopify GraphQL', { productId, gid });

  const data = await runQuery(GET_PRODUCT_QUERY, { id: gid });

  if (!data?.product) {
    logger.warn('Product not found in Shopify', { productId, gid });
    return {
      title: null, status: null, vendor: null, productType: null,
      variantPrice: null, variantSku: null, compareAtPrice: null, inventoryQuantity: null,
    };
  }

  const product      = data.product;
  const firstVariant = product.variants?.edges?.[0]?.node ?? null;

  return {
    title:             product.title          ?? null,
    status:            product.status         ?? null,
    vendor:            product.vendor         ?? null,
    productType:       product.productType    ?? null,
    variantPrice:      firstVariant?.price    ?? null,
    variantSku:        firstVariant?.sku      ?? null,
    compareAtPrice:    firstVariant?.compareAtPrice    ?? null,
    inventoryQuantity: firstVariant?.inventoryQuantity ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Query 2: Multiple Products (Batch)
// One GraphQL call instead of N calls — much more efficient for
// orders with multiple line items.
// ─────────────────────────────────────────────────────────────────────

const GET_MULTIPLE_PRODUCTS_QUERY = `
  query GetMultipleProducts($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        title
        status
        vendor
        variants(first: 1) {
          edges {
            node {
              price
              sku
              inventoryQuantity
            }
          }
        }
      }
    }
  }
`;

/**
 * Fetch multiple products in a single GraphQL request.
 * Use this when an order has multiple line items — avoids N+1 calls.
 *
 * @param {Array<string|number>} productIds
 * @returns {Promise<Map<string, Object>>} Map of productId → product data
 */
async function fetchMultipleProducts(productIds) {
  if (!productIds || productIds.length === 0) return new Map();

  const gids = productIds.map(toGid);

  logger.debug('Batch fetching products from Shopify GraphQL', { count: productIds.length });

  const data = await runQuery(GET_MULTIPLE_PRODUCTS_QUERY, { ids: gids });

  const resultMap = new Map();

  for (const node of (data?.nodes ?? [])) {
    if (!node?.id) continue;

    // Extract numeric ID from GID: "gid://shopify/Product/123" → "123"
    const numericId    = node.id.split('/').pop();
    const firstVariant = node.variants?.edges?.[0]?.node ?? null;

    resultMap.set(numericId, {
      title:             node.title          ?? null,
      status:            node.status         ?? null,
      vendor:            node.vendor         ?? null,
      variantPrice:      firstVariant?.price ?? null,
      variantSku:        firstVariant?.sku   ?? null,
      inventoryQuantity: firstVariant?.inventoryQuantity ?? null,
    });
  }

  logger.debug('Batch product fetch complete', {
    requested: productIds.length,
    returned:  resultMap.size,
  });

  return resultMap;
}

module.exports = { fetchProductDetails, fetchMultipleProducts };

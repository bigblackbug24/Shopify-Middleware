const shopifyClient      = require('./shopifyClient');
const { shopifyLimiter } = require('./shopifyRateLimiter');
const { withShopifyRetry } = require('../utils/retry');
const logger             = require('../utils/logger');

const GRAPHQL_ENDPOINT = '/graphql.json';

/**
 * Execute a GraphQL query/mutation against Shopify Admin API.
 * Rate-limited via Bottleneck + retry via withShopifyRetry.
 */
async function runQuery(query, variables = {}) {
  const response = await shopifyLimiter.schedule(() =>
    withShopifyRetry(
      () => shopifyClient.post(GRAPHQL_ENDPOINT, { query, variables }),
      'Shopify Inventory GraphQL'
    )
  );

  const { data, errors } = response.data;

  if (errors && errors.length > 0) {
    const msg = errors.map((e) => e.message).join(' | ');
    throw new Error(`Shopify GraphQL error: ${msg}`);
  }

  return data;
}

// ─────────────────────────────────────────────────────────────────────
// Query: Get inventoryItemId + locationId for a variant
// ─────────────────────────────────────────────────────────────────────

const GET_VARIANT_INVENTORY_QUERY = `
  query GetVariantInventory($id: ID!) {
    productVariant(id: $id) {
      id
      sku
      inventoryItem {
        id
        inventoryLevels(first: 5) {
          edges {
            node {
              id
              location {
                id
                name
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * Get inventoryItemId and locationId for a Shopify product variant.
 *
 * We need these two IDs to call the inventory mutation.
 * inventoryItemId — the inventory tracking record
 * locationId      — where the stock is physically stored
 *
 * @param {string} variantId - Shopify numeric variant ID
 * @param {string} [preferredLocationId] - Optional GID to prefer a specific location
 * @returns {Promise<{ inventoryItemId: string, locationId: string }>}
 */
async function getInventoryDetails(variantId, preferredLocationId = null) {
  const gid = `gid://shopify/ProductVariant/${variantId}`;

  logger.debug('Fetching inventory details from Shopify', { variantId, gid });

  const data = await runQuery(GET_VARIANT_INVENTORY_QUERY, { id: gid });

  const variant = data?.productVariant;
  if (!variant) {
    throw new Error(`Variant not found in Shopify: variantId=${variantId}`);
  }

  const inventoryItemId = variant.inventoryItem?.id;
  if (!inventoryItemId) {
    throw new Error(`Variant ${variantId} has no inventoryItem — inventory tracking may be disabled`);
  }

  const levels = variant.inventoryItem?.inventoryLevels?.edges ?? [];
  if (levels.length === 0) {
    throw new Error(`Variant ${variantId} has no inventory locations configured in Shopify`);
  }

  // Use preferred location if provided and found, otherwise use first location
  let selectedLevel = levels[0].node;
  if (preferredLocationId) {
    const preferred = levels.find((e) => e.node.location.id === preferredLocationId);
    if (preferred) {
      selectedLevel = preferred.node;
    } else {
      logger.warn('Preferred location not found — using first available', {
        preferredLocationId,
        available: levels.map((e) => e.node.location.id),
      });
    }
  }

  const locationId = selectedLevel.location.id;

  logger.debug('Inventory details fetched', {
    variantId,
    inventoryItemId,
    locationId,
    locationName: selectedLevel.location.name,
  });

  return { inventoryItemId, locationId };
}

// ─────────────────────────────────────────────────────────────────────
// Mutation: Set absolute inventory quantity
// Uses inventorySetOnHandQuantities (API 2023-01+)
// This is an ABSOLUTE set — not a relative adjustment.
// ─────────────────────────────────────────────────────────────────────

const SET_INVENTORY_MUTATION = `
  mutation SetInventory($input: InventorySetOnHandQuantitiesInput!) {
    inventorySetOnHandQuantities(input: $input) {
      userErrors {
        field
        message
        code
      }
      inventoryAdjustmentGroup {
        createdAt
        reason
        changes {
          name
          delta
          quantityAfterChange
        }
      }
    }
  }
`;

/**
 * Set absolute inventory quantity on Shopify.
 *
 * Required Shopify app scopes: write_inventory, read_inventory
 *
 * @param {Object} params
 * @param {string} params.inventoryItemId - GID e.g. "gid://shopify/InventoryItem/123"
 * @param {string} params.locationId      - GID e.g. "gid://shopify/Location/456"
 * @param {number} params.quantity        - Absolute quantity to set (not delta)
 * @returns {Promise<Object>} Shopify mutation result
 */
async function setInventoryQuantity({ inventoryItemId, locationId, quantity }) {
  logger.debug('Setting Shopify inventory', { inventoryItemId, locationId, quantity });

  const data = await runQuery(SET_INVENTORY_MUTATION, {
    input: {
      reason: 'correction',
      setQuantities: [
        { inventoryItemId, locationId, quantity },
      ],
    },
  });

  // Shopify returns userErrors in the mutation response (not in top-level errors)
  // These must be checked manually — they come back with HTTP 200
  const userErrors = data?.inventorySetOnHandQuantities?.userErrors ?? [];
  if (userErrors.length > 0) {
    const msg = userErrors.map((e) => `${e.field}: ${e.message}`).join(' | ');
    throw new Error(`Shopify inventory userErrors: ${msg}`);
  }

  const adjustmentGroup = data?.inventorySetOnHandQuantities?.inventoryAdjustmentGroup;

  logger.info('Shopify inventory updated successfully', {
    inventoryItemId,
    locationId,
    quantity,
    changes: adjustmentGroup?.changes,
  });

  return { adjustmentGroup };
}

module.exports = { getInventoryDetails, setInventoryQuantity };

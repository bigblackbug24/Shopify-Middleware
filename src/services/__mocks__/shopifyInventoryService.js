/**
 * Mock Shopify Inventory Service.
 * Active when: USE_MOCK_SHOPIFY=true
 *
 * Simulates:
 *  - getInventoryDetails — returns fake GIDs
 *  - setInventoryQuantity — logs and returns success
 *  - "NOLOCATION" variantId → throws (test error handling)
 */
const logger = require('../../utils/logger');

async function getInventoryDetails(variantId, preferredLocationId = null) {
  await new Promise((r) => setTimeout(r, 30)); // simulate network

  if (String(variantId).toUpperCase().includes('NOLOCATION')) {
    throw new Error(`Mock: No inventory location for variant ${variantId}`);
  }

  return {
    inventoryItemId: `gid://shopify/InventoryItem/MOCK_${variantId}`,
    locationId:      preferredLocationId || 'gid://shopify/Location/MOCK_LOC_001',
  };
}

async function setInventoryQuantity({ inventoryItemId, locationId, quantity }) {
  await new Promise((r) => setTimeout(r, 30)); // simulate network

  logger.info('[MOCK] Shopify inventory set', { inventoryItemId, locationId, quantity });

  return {
    adjustmentGroup: {
      createdAt: new Date().toISOString(),
      reason:    'correction',
      changes:   [{ name: 'available', delta: quantity, quantityAfterChange: quantity }],
    },
  };
}

module.exports = { getInventoryDetails, setInventoryQuantity };

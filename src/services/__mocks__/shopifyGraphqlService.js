/**
 * Mock Shopify GraphQL service.
 *
 * Active when: USE_MOCK_SHOPIFY=true in .env
 * Purpose: develop and test without a real Shopify store.
 *
 * Simulates:
 *  - Realistic product data
 *  - Small network delay (50ms)
 *  - "Not found" for product IDs starting with "NOTFOUND"
 *  - Error simulation for product IDs starting with "ERROR"
 */

const MOCK_DELAY_MS = 50;

/**
 * Mock fetchProductDetails — mirrors real service signature exactly.
 *
 * @param {string|number} productId
 * @returns {Promise<Object>}
 */
async function fetchProductDetails(productId) {
  await new Promise((r) => setTimeout(r, MOCK_DELAY_MS));

  const id = String(productId);

  // Simulate "product not found"
  if (id.toUpperCase().startsWith('NOTFOUND')) {
    return {
      title:             null,
      status:            null,
      vendor:            null,
      productType:       null,
      variantPrice:      null,
      variantSku:        null,
      compareAtPrice:    null,
      inventoryQuantity: null,
    };
  }

  // Simulate GraphQL error
  if (id.toUpperCase().startsWith('ERROR')) {
    throw new Error(`Mock GraphQL error for product ${id}`);
  }

  // Normal mock response
  return {
    title:             `Mock Product ${id}`,
    status:            'ACTIVE',
    vendor:            'Mock Vendor',
    productType:       'Mock Type',
    variantPrice:      '49.99',
    variantSku:        `SKU-${id}`,
    compareAtPrice:    '59.99',
    inventoryQuantity: 100,
  };
}

/**
 * Mock fetchMultipleProducts — mirrors real service signature exactly.
 *
 * @param {Array<string|number>} productIds
 * @returns {Promise<Map<string, Object>>}
 */
async function fetchMultipleProducts(productIds) {
  await new Promise((r) => setTimeout(r, MOCK_DELAY_MS));

  const resultMap = new Map();

  for (const productId of productIds) {
    const id = String(productId);

    if (id.toUpperCase().startsWith('NOTFOUND')) continue; // not found = not in map

    if (!id.toUpperCase().startsWith('ERROR')) {
      resultMap.set(id, {
        title:             `Mock Product ${id}`,
        status:            'ACTIVE',
        vendor:            'Mock Vendor',
        variantPrice:      '49.99',
        variantSku:        `SKU-${id}`,
        inventoryQuantity: 100,
      });
    }
  }

  return resultMap;
}

module.exports = { fetchProductDetails, fetchMultipleProducts };

require('dotenv').config();

/**
 * Shopify-specific configuration.
 * Isolated here so swapping stores = changing 4 env vars only.
 */
const shopifyConfig = {
  storeDomain:   process.env.SHOPIFY_STORE_DOMAIN,
  accessToken:   process.env.SHOPIFY_ACCESS_TOKEN,
  webhookSecret: process.env.SHOPIFY_WEBHOOK_SECRET,
  apiVersion:    process.env.SHOPIFY_API_VERSION || '2024-01',
  useMock:       process.env.USE_MOCK_SHOPIFY === 'true',

  // Derived — full base URL for Admin API
  get adminApiBaseUrl() {
    return `https://${this.storeDomain}/admin/api/${this.apiVersion}`;
  },
};

module.exports = shopifyConfig;

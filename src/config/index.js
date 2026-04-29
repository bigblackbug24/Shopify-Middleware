require('dotenv').config();

const config = {
  app: {
    env:  process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT, 10) || 3000,
    url:  process.env.APP_URL || 'http://localhost:3000',
  },

  db: {
    host:     process.env.DB_HOST,
    port:     parseInt(process.env.DB_PORT, 10) || 3306,
    name:     process.env.DB_NAME,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  },

  redis: {
    host:     process.env.REDIS_HOST || '127.0.0.1',
    port:     parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
  },

  shopify: {
    storeDomain:   process.env.SHOPIFY_STORE_DOMAIN,
    accessToken:   process.env.SHOPIFY_ACCESS_TOKEN,
    webhookSecret: process.env.SHOPIFY_WEBHOOK_SECRET,
    apiVersion:    process.env.SHOPIFY_API_VERSION || '2024-01',
    useMock:       process.env.USE_MOCK_SHOPIFY === 'true',
  },

  queue: {
    name:         process.env.QUEUE_NAME || 'order-processing',
    concurrency:  parseInt(process.env.QUEUE_CONCURRENCY, 10) || 5,
    maxAttempts:  parseInt(process.env.JOB_MAX_ATTEMPTS, 10) || 3,
    backoffDelay: parseInt(process.env.JOB_BACKOFF_DELAY, 10) || 5000,
  },

  log: {
    level: process.env.LOG_LEVEL || 'info',
    file:  process.env.LOG_FILE || 'logs/app.log',
  },
};

// ── Startup validation — fail fast if required vars are missing ──────
const required = [
  'DB_HOST',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
  'SHOPIFY_STORE_DOMAIN',
  'SHOPIFY_ACCESS_TOKEN',
  'SHOPIFY_WEBHOOK_SECRET',
];

const missing = required.filter((key) => !process.env[key]);

if (missing.length > 0) {
  throw new Error(
    `Missing required environment variables:\n  ${missing.join('\n  ')}\n\nCopy .env.example to .env and fill in the values.`
  );
}

module.exports = config;

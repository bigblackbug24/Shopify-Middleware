require('dotenv').config();

/**
 * Knex database configuration.
 * Used by both the app (src/models/db.js) and the Knex CLI (migrations).
 *
 * NOTE: dotenv loaded here directly so `npm run migrate` works
 * from CLI without going through src/config/index.js first.
 */
const dbConfig = {
  client: 'mysql2',
  connection: {
    host:     process.env.DB_HOST     || '127.0.0.1',
    port:     parseInt(process.env.DB_PORT, 10) || 3306,
    database: process.env.DB_NAME     || 'shopify_middleware',
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || 'secret',
    charset:  'utf8mb4',
  },
  pool: {
    min: 2,
    max: 10,
  },
  migrations: {
    // Path relative to project root (where knex CLI runs from)
    directory: './migrations',
    tableName: 'knex_migrations',
  },
};

module.exports = dbConfig;

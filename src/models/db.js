const knex = require('knex');
const dbConfig = require('../config/database');

/**
 * Knex singleton instance.
 * Import this wherever you need DB access — same connection pool reused.
 *
 * Usage:
 *   const db = require('./db');
 *   const rows = await db('orders').where({ status: 'pending' });
 */
const db = knex(dbConfig);

// Verify connection on startup — crash early if DB is unreachable
db.raw('SELECT 1')
  .then(() => {
    console.log('MySQL connected successfully');
  })
  .catch((err) => {
    console.error('MySQL connection failed:', err.message);
    console.error('Check DB_HOST, DB_USER, DB_PASSWORD, DB_NAME in your .env');
    process.exit(1);
  });

module.exports = db;

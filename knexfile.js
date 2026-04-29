/**
 * Knex CLI configuration file.
 * Required at project root for `knex migrate:*` commands to work.
 *
 * This just re-exports the same config used by the app.
 */
module.exports = require('./src/config/database');

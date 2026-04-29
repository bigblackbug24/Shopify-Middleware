require('dotenv').config();
const { Redis } = require('ioredis');
const redisConfig = require('../config/redis');

/**
 * Dedicated Redis connection for BullMQ.
 *
 * WHY a separate connection?
 *  - BullMQ requires maxRetriesPerRequest = null
 *  - This setting breaks regular Redis usage (get/set/etc.)
 *  - So BullMQ gets its own connection, app gets another if needed
 *
 * RULES:
 *  - maxRetriesPerRequest: null  → required by BullMQ
 *  - enableReadyCheck: false     → required by BullMQ
 *  - lazyConnect: true           → don't connect until first command
 */
const connection = new Redis({
  host:     redisConfig.host,
  port:     redisConfig.port,
  ...(redisConfig.password ? { password: redisConfig.password } : {}),
  maxRetriesPerRequest: null,
  enableReadyCheck:     false,
  lazyConnect:          true,

  // Reconnect strategy — retry with backoff on disconnect
  retryStrategy(times) {
    if (times > 10) {
      console.error('❌ Redis: max reconnect attempts reached');
      return null; // stop retrying
    }
    const delay = Math.min(times * 500, 5000); // 500ms, 1s, 1.5s ... max 5s
    console.warn(`⚠️  Redis: reconnecting in ${delay}ms (attempt ${times})`);
    return delay;
  },
});

connection.on('connect',      ()    => console.log('✅ Redis connected'));
connection.on('ready',        ()    => console.log('✅ Redis ready'));
connection.on('reconnecting', ()    => console.warn('⚠️  Redis reconnecting...'));
connection.on('error',        (err) => console.error('❌ Redis error:', err.message));
connection.on('close',        ()    => console.warn('⚠️  Redis connection closed'));

module.exports = connection;

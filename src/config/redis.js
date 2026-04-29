require('dotenv').config();

/**
 * Redis connection config for BullMQ.
 *
 * IMPORTANT: maxRetriesPerRequest must be null — BullMQ requirement.
 * Do NOT use this config for regular Redis caching; create a separate
 * connection for that to avoid BullMQ conflicts.
 */
const redisConfig = {
  host:     process.env.REDIS_HOST || '127.0.0.1',
  port:     parseInt(process.env.REDIS_PORT, 10) || 6379,
  // Only include password key if a value is set (ioredis rejects empty string auth)
  ...(process.env.REDIS_PASSWORD ? { password: process.env.REDIS_PASSWORD } : {}),
  maxRetriesPerRequest: null,  // Required by BullMQ
};

module.exports = redisConfig;

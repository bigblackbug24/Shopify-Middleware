const winston = require('winston');
const config  = require('../config');

const { combine, timestamp, printf, colorize, json, errors, metadata } = winston.format;

// ─────────────────────────────────────────────────────────────────────
// Formats
// ─────────────────────────────────────────────────────────────────────

/**
 * Human-readable colored format for development.
 * Example:
 *   10:45:12 [info]: Order job queued {"shopifyOrderId":123}
 */
const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp, stack, ...meta }) => {
    // Remove internal winston fields from meta output
    delete meta.service;
    const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    return `${timestamp} [${level}]: ${message}${metaStr}${stack ? '\n' + stack : ''}`;
  })
);

/**
 * Structured JSON format for production.
 * Ingestible by Datadog, CloudWatch, Loki, etc.
 * Example:
 *   {"level":"info","message":"Order queued","shopifyOrderId":123,"timestamp":"..."}
 */
const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
);

// ─────────────────────────────────────────────────────────────────────
// Logger instance
// ─────────────────────────────────────────────────────────────────────
const logger = winston.createLogger({
  level:  config.log.level,
  format: config.app.env === 'production' ? prodFormat : devFormat,

  // Default metadata added to every log line
  defaultMeta: { service: 'shopify-middleware' },

  transports: [
    // Console — always on
    new winston.transports.Console(),

    // Error-only file — 5MB, keep 5 rotated files
    new winston.transports.File({
      filename: 'logs/error.log',
      level:    'error',
      maxsize:  5 * 1024 * 1024,
      maxFiles: 5,
    }),

    // All levels file — 10MB, keep 5 rotated files
    new winston.transports.File({
      filename: config.log.file,
      maxsize:  10 * 1024 * 1024,
      maxFiles: 5,
    }),
  ],
});

// ─────────────────────────────────────────────────────────────────────
// Child logger factory
// Use this to attach persistent context to a set of log calls.
//
// Example:
//   const jobLogger = logger.child({ jobId: job.id, shopifyOrderId: 123 });
//   jobLogger.info('Processing');   // → includes jobId + shopifyOrderId automatically
// ─────────────────────────────────────────────────────────────────────
logger.child = (meta) => {
  return {
    debug: (msg, extra = {}) => logger.debug(msg, { ...meta, ...extra }),
    info:  (msg, extra = {}) => logger.info(msg,  { ...meta, ...extra }),
    warn:  (msg, extra = {}) => logger.warn(msg,  { ...meta, ...extra }),
    error: (msg, extra = {}) => logger.error(msg, { ...meta, ...extra }),
  };
};

module.exports = logger;

const logger   = require('../utils/logger');
const AppError = require('../utils/AppError');

/**
 * Global Express error handler.
 * MUST be registered LAST in app.js — after all routes.
 *
 * Handles three categories of errors:
 *
 *  1. AppError (operational) — known errors we threw intentionally
 *     e.g. 404 Not Found, 422 Validation Error
 *     → Return the error message to the client
 *
 *  2. Known third-party errors — DB errors, JSON parse errors, etc.
 *     → Map to a clean response, don't leak internals
 *
 *  3. Unknown errors — bugs, unexpected crashes
 *     → Log full details, return generic 500 to client
 *     → Never expose stack traces in production
 *
 * How to trigger from a route:
 *   throw new AppError('Not found', 404);          // inside asyncHandler
 *   next(new AppError('Bad input', 400));           // anywhere
 *   next(err);                                      // forward any error
 */
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const isProduction = process.env.NODE_ENV === 'production';

  // ── Classify the error ────────────────────────────────────────────

  let statusCode = 500;
  let errorCode  = 'INTERNAL_ERROR';
  let message    = 'Internal Server Error';
  let meta       = {};

  if (err instanceof AppError) {
    // Known operational error — safe to expose message
    statusCode = err.statusCode;
    errorCode  = err.code;
    message    = err.message;
    meta       = err.meta || {};

  } else if (err.type === 'entity.parse.failed') {
    // express.json() failed to parse body
    statusCode = 400;
    errorCode  = 'INVALID_JSON';
    message    = 'Request body is not valid JSON';

  } else if (err.code === 'ER_DUP_ENTRY') {
    // MySQL duplicate key
    statusCode = 409;
    errorCode  = 'DUPLICATE_ENTRY';
    message    = 'Resource already exists';

  } else if (err.code === 'ECONNREFUSED') {
    // DB or Redis connection refused
    statusCode = 503;
    errorCode  = 'SERVICE_UNAVAILABLE';
    message    = 'A required service is unavailable';

  } else if (err.name === 'ValidationError') {
    // Joi validation error (if thrown directly)
    statusCode = 422;
    errorCode  = 'VALIDATION_ERROR';
    message    = err.message;
  }

  // ── Log the error ─────────────────────────────────────────────────

  const logPayload = {
    method:    req.method,
    path:      req.path,
    statusCode,
    errorCode,
    message:   err.message,
    // Always log stack in server logs — just don't send it to client in prod
    stack:     err.stack,
  };

  if (statusCode >= 500) {
    logger.error('Request error', logPayload);
  } else if (statusCode >= 400) {
    logger.warn('Request error', logPayload);
  }

  // ── Send response ─────────────────────────────────────────────────

  const responseBody = {
    error: {
      message,
      code: errorCode,
      ...meta,
    },
  };

  // Include stack trace in dev — never in production
  if (!isProduction && err.stack) {
    responseBody.error.stack = err.stack;
  }

  return res.status(statusCode).json(responseBody);
}

module.exports = errorHandler;

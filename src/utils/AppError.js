/**
 * Custom application error class.
 *
 * Use this instead of throwing raw Error objects so we can:
 *  - Set HTTP status codes
 *  - Classify error types (validation, db, external API, etc.)
 *  - Add structured metadata
 *
 * Example:
 *   throw new AppError('Order not found', 404, 'NOT_FOUND');
 *   throw new AppError('Invalid email', 400, 'VALIDATION_ERROR', { field: 'email' });
 */
class AppError extends Error {
  /**
   * @param {string} message      - Human-readable error message
   * @param {number} statusCode   - HTTP status code (400, 404, 500, etc.)
   * @param {string} [code]       - Machine-readable error code (VALIDATION_ERROR, NOT_FOUND, etc.)
   * @param {Object} [meta]       - Additional structured data
   */
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', meta = {}) {
    super(message);

    this.name       = 'AppError';
    this.statusCode = statusCode;
    this.code       = code;
    this.meta       = meta;
    this.isOperational = true; // Marks this as a known/expected error

    // Capture stack trace (V8 only)
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Convert to JSON for API responses.
   */
  toJSON() {
    return {
      error: {
        message: this.message,
        code:    this.code,
        ...this.meta,
      },
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Factory methods for common error types
// ─────────────────────────────────────────────────────────────────────

AppError.badRequest = (message, meta = {}) =>
  new AppError(message, 400, 'BAD_REQUEST', meta);

AppError.unauthorized = (message = 'Unauthorized', meta = {}) =>
  new AppError(message, 401, 'UNAUTHORIZED', meta);

AppError.forbidden = (message = 'Forbidden', meta = {}) =>
  new AppError(message, 403, 'FORBIDDEN', meta);

AppError.notFound = (message, meta = {}) =>
  new AppError(message, 404, 'NOT_FOUND', meta);

AppError.conflict = (message, meta = {}) =>
  new AppError(message, 409, 'CONFLICT', meta);

AppError.validationError = (message, meta = {}) =>
  new AppError(message, 422, 'VALIDATION_ERROR', meta);

AppError.tooManyRequests = (message = 'Too many requests', meta = {}) =>
  new AppError(message, 429, 'RATE_LIMIT_EXCEEDED', meta);

AppError.internal = (message = 'Internal server error', meta = {}) =>
  new AppError(message, 500, 'INTERNAL_ERROR', meta);

AppError.serviceUnavailable = (message = 'Service unavailable', meta = {}) =>
  new AppError(message, 503, 'SERVICE_UNAVAILABLE', meta);

module.exports = AppError;

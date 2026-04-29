const logger = require('./logger');

/**
 * Retry an async function with exponential backoff + jitter.
 *
 * WHY jitter?
 *  Without jitter, all retries fire at the same time after a failure
 *  (thundering herd). Adding random jitter spreads them out.
 *
 * Backoff formula:
 *  delay = min(baseDelay * 2^(attempt-1), maxDelay) + random(0, 1000)
 *
 *  attempt 1 → immediate
 *  attempt 2 → ~1000ms + jitter
 *  attempt 3 → ~2000ms + jitter
 *  attempt 4 → ~4000ms + jitter
 *  ...capped at maxDelay
 *
 * @param {Function} fn                    - Async function to retry
 * @param {Object}   [options]
 * @param {number}   [options.attempts=3]  - Max total attempts
 * @param {number}   [options.baseDelay=1000]  - Initial delay in ms
 * @param {number}   [options.maxDelay=30000]  - Max delay cap in ms
 * @param {Function} [options.shouldRetry]     - Return false to stop retrying early
 * @param {string}   [options.label]           - Label for log messages
 *
 * @returns {Promise<*>} Result of fn()
 * @throws  Last error if all attempts fail
 *
 * @example
 * // Basic usage
 * const data = await withRetry(() => fetchProductDetails(productId));
 *
 * @example
 * // Don't retry 404s
 * const data = await withRetry(
 *   () => fetchProductDetails(productId),
 *   {
 *     attempts: 3,
 *     baseDelay: 1000,
 *     shouldRetry: (err) => err.response?.status !== 404,
 *     label: `fetchProduct(${productId})`,
 *   }
 * );
 */
async function withRetry(fn, options = {}) {
  const {
    attempts    = 3,
    baseDelay   = 1000,
    maxDelay    = 30000,
    shouldRetry = () => true,
    label       = 'operation',
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      const isLastAttempt = attempt === attempts;
      const willRetry     = !isLastAttempt && shouldRetry(err);

      if (!willRetry) {
        logger.warn(`${label} failed — no more retries`, {
          attempt,
          maxAttempts: attempts,
          error:       err.message,
          willRetry:   false,
        });
        break;
      }

      // Exponential backoff with jitter
      const exponential = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
      const jitter      = Math.floor(Math.random() * 1000); // 0–999ms
      const delay       = exponential + jitter;

      logger.warn(`${label} failed — retrying`, {
        attempt,
        maxAttempts: attempts,
        nextAttempt: attempt + 1,
        delayMs:     delay,
        error:       err.message,
      });

      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError;
}

/**
 * Retry specifically for Shopify API calls.
 * Pre-configured: 3 attempts, 1s base delay, skip retry on 404/401.
 *
 * @param {Function} fn
 * @param {string}   [label]
 */
async function withShopifyRetry(fn, label = 'Shopify API call') {
  return withRetry(fn, {
    attempts:  3,
    baseDelay: 1000,
    maxDelay:  10000,
    label,
    shouldRetry: (err) => {
      const status = err.response?.status;
      // Don't retry: 404 (not found), 401 (bad token), 403 (forbidden)
      if (status === 404 || status === 401 || status === 403) return false;
      return true;
    },
  });
}

module.exports = { withRetry, withShopifyRetry };

/**
 * Wraps async Express route handlers so errors are forwarded to next().
 *
 * WHY this is needed:
 *   Express 4 does NOT catch async errors automatically.
 *   Without this wrapper, a thrown error inside an async route
 *   causes an unhandled promise rejection — the request hangs forever.
 *
 * Usage:
 *   router.get('/orders', asyncHandler(async (req, res) => {
 *     const orders = await Order.findAll();  // if this throws, next(err) is called
 *     res.json(orders);
 *   }));
 *
 * Note: Express 5 handles this natively, but we're on Express 4.
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;

require('dotenv').config();

const express        = require('express');
const logger         = require('./utils/logger');
const errorHandler   = require('./middleware/errorHandler');
const requestLogger  = require('./middleware/requestLogger');

const app = express();

// ── Request logger — log every incoming request ──────────────────────
app.use(requestLogger);

// ── Raw body capture for webhook HMAC validation ─────────────────────
// express.json() verify callback captures raw bytes for HMAC check,
// while still parsing JSON normally into req.body.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      if (req.url.startsWith('/webhook')) {
        req.rawBody = buf.toString('utf8');
      }
    },
  })
);
app.use(express.urlencoded({ extended: true }));

// ── Bull Board — Queue Dashboard ──────────────────────────────────────
// Visual UI to inspect jobs: waiting, active, completed, failed
// Available at: http://localhost:3000/admin/queues
try {
  const { createBullBoard }  = require('@bull-board/api');
  const { BullMQAdapter }    = require('@bull-board/api/bullMQAdapter');
  const { ExpressAdapter }   = require('@bull-board/express');
  const { orderQueue }       = require('./queues/orderQueue');
  const { inventoryQueue }   = require('./queues/inventoryQueue');

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');

  createBullBoard({
    queues: [
      new BullMQAdapter(orderQueue),
      new BullMQAdapter(inventoryQueue),
    ],
    serverAdapter,
  });

  app.use('/admin/queues', serverAdapter.getRouter());
  logger.info('Bull Board dashboard available at /admin/queues');
} catch (err) {
  logger.warn('Bull Board not available', { error: err.message });
}

// ── Routes ────────────────────────────────────────────────────────────
app.use('/webhook', require('./routes/webhook'));
app.use('/health',  require('./routes/health'));
app.use('/orders',  require('./routes/orders'));

// ── 404 handler ───────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ── Global error handler — MUST be last ──────────────────────────────
app.use(errorHandler);

// ── Process-level error handlers ─────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection', { reason: String(reason) });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception — shutting down', { error: err.message, stack: err.stack });
  process.exit(1);
});

module.exports = app;

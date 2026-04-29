# Shopify Middleware — Bi-directional Sync

A production-ready Node.js middleware that handles Shopify webhooks asynchronously using Redis queues, MySQL persistence, and GraphQL API integration.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     INBOUND FLOW                            │
│                                                             │
│  Shopify ──► POST /webhook/order-created                    │
│                    │                                        │
│              Validate HMAC signature                        │
│              Idempotency check (DB)                         │
│                    │                                        │
│              Redis Queue (BullMQ) ── order-processing       │
│                    │                                        │
│              Order Worker                                   │
│              ├── Save to MySQL (orders + order_items)       │
│              ├── Fetch product data via Shopify GraphQL     │
│              └── Mark order completed                       │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                     OUTBOUND FLOW                           │
│                                                             │
│  Third-Party ──► POST /webhook/inventory-update             │
│                    │                                        │
│              Validate payload (sku + quantity)              │
│                    │                                        │
│              Redis Queue (BullMQ) ── inventory-processing   │
│                    │                                        │
│              Inventory Worker                               │
│              ├── Map SKU → variant_id (DB lookup)           │
│              ├── Get inventoryItemId + locationId (GraphQL) │
│              ├── Update Shopify inventory (GraphQL Mutation) │
│              └── Update synced_quantity in local DB         │
└─────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 18+ |
| Framework | Express.js |
| Queue | BullMQ + Redis 7 |
| Database | MySQL 8 + Knex |
| HTTP Client | Axios |
| Validation | Joi |
| Logging | Winston |
| Rate Limiting | Bottleneck |
| Containerization | Docker Compose |

---

## Database Schema

### `orders`
| Column | Type | Notes |
|--------|------|-------|
| `id` | INT PK | Auto increment |
| `shopify_order_id` | BIGINT UNIQUE | Idempotency key |
| `customer_email` | VARCHAR(255) | Indexed |
| `total_price` | DECIMAL(10,2) | Not FLOAT — avoids rounding |
| `status` | ENUM | pending / processing / completed / failed |
| `created_at` | TIMESTAMP | Indexed |
| `updated_at` | TIMESTAMP | Auto-updated |

### `order_items`
| Column | Type | Notes |
|--------|------|-------|
| `id` | INT PK | Auto increment |
| `order_id` | INT FK | → orders.id CASCADE DELETE |
| `product_id` | VARCHAR(100) | Shopify product ID |
| `variant_id` | VARCHAR(100) | Shopify variant ID |
| `sku` | VARCHAR(255) | From webhook payload, indexed |
| `quantity` | SMALLINT | Units ordered (never changes) |
| `synced_quantity` | INT | Stock level last pushed to Shopify |
| `synced_at` | TIMESTAMP | When inventory was last synced |
| `price` | DECIMAL(10,2) | |
| `product_title` | VARCHAR(500) | Enriched from GraphQL |
| `variant_sku` | VARCHAR(100) | Enriched from GraphQL |
| `variant_price` | VARCHAR(20) | Enriched from GraphQL |

---

## Quick Start

### Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) — must be running

### One command:
```bash
git clone <your-repo>
cd shopify-middleware
docker-compose up --build
```

Starts MySQL, Redis, runs migrations, starts API server and background worker automatically.

First run ~2-3 minutes. Subsequent runs:
```bash
docker-compose up
```

---

## Configuration

```bash
cp .env.example .env
```

Key variables:

```env
# Shopify credentials
SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_xxxxxxxxxxxxxxxx
SHOPIFY_WEBHOOK_SECRET=your_webhook_secret_here

# Dev mode — no real Shopify store needed
USE_MOCK_SHOPIFY=true
SKIP_HMAC_VERIFY=true
```

**Required Shopify app scopes:**
- `read_products`
- `read_orders`
- `read_inventory`
- `write_inventory` ← needed for inventory mutation

---

## API Endpoints

### Inbound (Shopify → System)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/webhook/order-created` | Receive Shopify order webhook |

### Outbound Trigger (Third-party → System → Shopify)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/webhook/inventory-update` | Receive inventory update, push to Shopify |

### Utility

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | MySQL + Redis + both queue metrics |
| `GET` | `/orders` | List orders (`?status=completed&limit=10`) |
| `GET` | `/orders/:id` | Single order with line items |
| `GET` | `/orders/shopify/:id` | Find by Shopify order ID |
| `GET` | `/orders/stats` | Count by status |
| `GET` | `/admin/queues` | Bull Board visual dashboard |

---

## Testing

### 1. Health check
```bash
curl http://localhost:3000/health
```

### 2. Inbound — Order webhook
```bash
curl -X POST http://localhost:3000/webhook/order-created \
  -H "Content-Type: application/json" \
  -d '{
    "id": 123456789,
    "email": "customer@example.com",
    "total_price": "199.99",
    "line_items": [{
      "product_id": "PROD001",
      "variant_id": "VAR001",
      "sku": "SKU-001",
      "quantity": 2,
      "price": "99.99"
    }]
  }'
```

Expected: `{ "status": "queued", "shopifyOrderId": 123456789 }`

### 3. Outbound — Inventory update
```bash
curl -X POST http://localhost:3000/webhook/inventory-update \
  -H "Content-Type: application/json" \
  -d '{ "sku": "SKU-001", "quantity": 50 }'
```

Expected: `{ "status": "queued", "sku": "SKU-001", "quantity": 50 }`

### 4. Check order — see synced_quantity updated
```bash
curl http://localhost:3000/orders/shopify/123456789
```

Response shows both:
- `quantity: 2` — units the customer ordered (never changes)
- `synced_quantity: 50` — stock level pushed to Shopify
- `synced_at: "2024-..."` — when the sync happened

### 5. Visual queue dashboard
```
http://localhost:3000/admin/queues
```

---

## Key Implementation Details

### Idempotency
- `UNIQUE KEY` on `shopify_order_id` — DB-level guarantee
- Controller pre-check before queueing — returns `{ status: "duplicate" }` immediately
- Worker handles `ER_DUP_ENTRY` gracefully on race conditions

### Queue Processing
- BullMQ on Redis — persistent, crash-safe
- Exponential backoff retry: 5s → 10s → 20s (3 attempts)
- Stalled job detection — auto re-queue if worker crashes mid-job
- Separate queues for orders and inventory — isolated failure domains

### Rate Limit Awareness
- Bottleneck library — proactive throttling before hitting Shopify limits
- Batch GraphQL queries — `fetchMultipleProducts()` for multi-item orders
- 429 auto-retry with `Retry-After` header respect
- `withShopifyRetry()` — exponential backoff + jitter on all API calls

### GraphQL Usage
- **Read:** `GetProduct` — fetch product title, price, SKU, inventory
- **Read:** `GetMultipleProducts` — N products in 1 API call (batch)
- **Read:** `GetVariantInventory` — fetch inventoryItemId + locationId
- **Write:** `inventorySetOnHandQuantities` — set absolute stock level on Shopify

### Inventory Sync
- After pushing to Shopify, `synced_quantity` and `synced_at` updated in local DB
- `quantity` (ordered units) is never overwritten — two separate concerns

---

## Project Structure

```
src/
├── config/          # All env vars centralized, validated on startup
├── controllers/     # webhookController, inventoryController
├── dtos/            # OrderWebhookDTO
├── middleware/      # HMAC verify, asyncHandler, errorHandler, requestLogger
├── models/          # Order.js, OrderItem.js
├── queues/          # orderQueue.js, inventoryQueue.js
├── routes/          # webhook.js, orders.js, health.js
├── services/        # shopifyGraphqlService, shopifyInventoryService,
│                    # shopifyClient, shopifyRateLimiter
├── utils/           # logger, AppError, retry
├── validators/      # orderWebhookValidator, inventoryWebhookValidator
├── workers/         # orderWorker, inventoryWorker, workerRunner
├── app.js
└── server.js

migrations/
├── 001_create_orders.js
├── 002_create_order_items.js
├── 003_add_sku_to_order_items.js
└── 004_add_synced_quantity_to_order_items.js
```

---

## Development (without Docker)

```bash
npm install
docker-compose up -d mysql redis   # still need these
npm run migrate
npm run dev      # Terminal 1 — API server
npm run worker   # Terminal 2 — Worker
```

---

## License

MIT

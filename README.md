# Payment Backend

An e-commerce order + payments backend built as a modular NestJS monolith. The goal is to demonstrate the patterns that separate a real payment integration from a Stripe tutorial clone: idempotent checkout, webhook-driven state transitions, transactional outbox delivery, and explicit state machines.

The demo domain is a **specialty coffee roaster** with a catalog of one-time bag purchases and an optional monthly Coffee Club subscription — concrete enough to make the API feel real, and structured so both one-time and recurring flows are exercised.

## Why a modular monolith (not microservices)

The code is organised into five modules with hard bounded contexts — `auth`, `orders`, `payments`, `inventory`, `notifications` — but ships as a single deployable. This is a deliberate portfolio-scope trade-off:

- **Cost of true microservices for one developer:** N deployables, N env matrices, N CI pipelines, and distributed tracing to debug basic flows. None of it demonstrates additional skill in an interview.
- **Cost of a shapeless monolith:** the "how would you scale this?" conversation dies immediately.

The middle path: enforce module boundaries at the code level (schema-per-module, no cross-schema FKs, no cross-module DB access, events for cross-module communication) so the modules could split into services later with no aggregate rewrite. The `payments` module in particular is designed to be extracted first — nothing else imports its entities, and its only public surface is the `payment.*` events it publishes via the outbox.

## The five patterns that carry the project

### 1. Idempotency keys on checkout

`POST /orders/:id/checkout` **requires** an `Idempotency-Key` header. The key is stored on the `payments.payments` row under a unique index. Two things happen with it:

- Replaying the same call returns the same `payment.id` and `client_secret` instead of creating a second Payment Intent.
- The key is passed through to Stripe as their own `Idempotency-Key`, so even if our short-circuit lookup missed (e.g. race between two parallel requests), Stripe still returns the same PI rather than charging twice.

Both layers defend against the same failure mode (client retrying on flaky network) at different points in the stack. See `payments.service.ts:checkout`.

### 2. Webhook-driven state transitions

The order transitions to `paid` only when Stripe's `payment_intent.succeeded` webhook arrives — never on client redirect. The client can close their browser mid-payment and the order still moves through the correct terminal state.

The webhook receiver at `POST /webhooks/stripe`:
- verifies the signature against `STRIPE_WEBHOOK_SECRET` using `stripe.webhooks.constructEvent` on the **raw request body** (preserved in `main.ts` via a targeted `express.json({ verify })` on that path),
- records the Stripe `event.id` in `payments.webhook_events` (retry-safe: duplicates short-circuit),
- transitions the order via the state machine,
- appends to the outbox — all in one DB transaction.

### 3. Transactional outbox

Every state-changing operation that needs to fan out (payment succeeded/failed, order created) writes an `outbox_events` row in the same DB transaction as the business change. A `SchedulerRegistry`-driven poller (`outbox.publisher.ts`) reads undispatched rows, publishes them to the event bus, and marks `dispatched_at`.

Why: without this, a broker outage between "commit payment" and "publish event" silently loses the notification. With it, the event is durable as soon as the txn commits, and the poller guarantees at-least-once delivery. Subscribers are idempotent to handle the redelivery case.

The poller is single-writer (a `running` guard prevents overlapping ticks) — a leader-election story would be needed for horizontal scale, and that's called out as future work rather than pretended-away.

### 4. Explicit order state machine

`OrderStateMachine` (`orders/order-state-machine.ts`) is an allowed-transitions map:

```
pending          → payment_pending | cancelled
payment_pending  → paid | failed | cancelled
paid             → preparing | cancelled
preparing        → shipped | cancelled
failed           → payment_pending   (retry path)
shipped, cancelled → (terminal)
```

Any illegal transition (`shipped → payment_pending`, etc.) throws `BadRequestException` before any state change is written. Concurrent transitions are serialised by a `SELECT ... FOR UPDATE` on the order row.

### 5. Stripe test mode + failure paths

The system is designed to be driven end-to-end against Stripe test mode. Success card `4242 4242 4242 4242`, decline card `4000 0000 0000 0002`. The failure path is not a bolt-on: `payment_intent.payment_failed` transitions the order to `failed`, emits `payment.failed`, and the state machine explicitly permits `failed → payment_pending` so a retry checkout call is legal.

## API

All order/payment endpoints require `Authorization: Bearer <jwt>`.

| Method | Path | Notes |
|---|---|---|
| `POST` | `/auth/signup` | body: `{ email, password }` |
| `POST` | `/auth/login` | returns `{ accessToken, user }` |
| `GET` | `/products` | list the coffee catalog |
| `GET` | `/products/:sku` | fetch one product |
| `POST` | `/orders` | creates a `pending` order; prices looked up server-side by SKU |
| `GET` | `/orders/:id` | order detail + current status |
| `GET` | `/orders/:id/events` | audit trail (used later for the realtime timeline) |
| `POST` | `/orders/:id/checkout` | requires `Idempotency-Key` header; returns Stripe `client_secret` |
| `POST` | `/webhooks/stripe` | Stripe webhook receiver (raw body, signature-verified) |
| `GET` | `/inventory` | list current stock |
| `GET` | `/inventory/:productId` | stock for one product |

## API docs

Interactive [Scalar](https://scalar.com/) reference at `http://localhost:3000/docs` once the app is running. Raw OpenAPI JSON at `/docs/json` (importable into Postman / code generators). The Stripe webhook endpoint is excluded from the docs — it's called by Stripe, not by end users.

## Data model

Each module owns one Postgres schema. **No cross-schema foreign keys.** Consistency across module boundaries is maintained by events, not by the database.

- `auth.users`
- `products.products` (seeded with 4 one-time SKUs + 1 recurring `coffee-club-monthly`)
- `orders.orders`, `orders.order_items`, `orders.order_events`
- `payments.payments`, `payments.webhook_events`
- `inventory.inventory`, `inventory.stock_adjustments` (idempotency ledger)
- `notifications.notifications_log`
- `outbox.outbox_events`

**Server-side pricing.** `POST /orders` only accepts `{ productId, quantity }` per item — never a `unitPrice`. Prices are pulled from `products.products` in the same request. Trusting a client-supplied price is the classic "$1 iPhone" e-commerce bug; the API is shaped to make that impossible.

**Recurring products are gated.** `products.type = 'recurring'` rows (currently just `coffee-club-monthly`) are rejected by `POST /orders` with a 400. They'll flow through a future subscriptions module using Stripe Subscriptions rather than one-shot PaymentIntents.

## Running locally

```bash
# 1. Copy env template and fill in Stripe test-mode keys
cp .env.example .env

# 2. Bring up Postgres + Redis
docker compose up -d

# 3. Install and run — migrations run automatically on boot
pnpm install
pnpm start:dev
```

To test the Stripe webhook end-to-end, use the [Stripe CLI](https://stripe.com/docs/stripe-cli):

```bash
stripe listen --forward-to localhost:3000/webhooks/stripe
# copy the whsec_... it prints into STRIPE_WEBHOOK_SECRET in .env
stripe trigger payment_intent.succeeded
```

## Deliberately out of scope

- **Frontend / realtime transport.** The `orders.order_events` audit table and the event bus are already shaped for a WebSocket/SSE gateway to consume without backend rework.
- **Multi-service deployment.** The module boundaries are the split points; extracting `payments` first would be a package-and-deploy exercise, not a rewrite.
- **Real email/SMS.** `notifications` writes the log row and logs the intent — swap in Resend/SendGrid at that seam.
- **Outbox publisher leader election.** Fine for a single instance; needs work for HA.

## Event bus driver

`EVENT_BUS_DRIVER=memory` (default) uses in-process `EventEmitter2`. `EVENT_BUS_DRIVER=redis` uses Redis pub/sub via the same `EventBus` interface — no subscriber code changes. The Redis impl exists so that "yes, this splits into services later" is a code demonstration, not a claim.

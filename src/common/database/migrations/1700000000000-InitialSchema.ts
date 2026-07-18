import { MigrationInterface, QueryRunner } from 'typeorm';

// One schema per module: preserves the "could split later" property by
// preventing accidental cross-module foreign keys and giving each module
// its own migration namespace if it ever splits into a separate service.
export class InitialSchema1700000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS auth`);
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS orders`);
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS payments`);
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS inventory`);
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS notifications`);
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS outbox`);

    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

    // ---- auth.users ----
    await queryRunner.query(`
      CREATE TABLE auth.users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ---- orders.orders ----
    await queryRunner.query(`
      CREATE TABLE orders.orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        status VARCHAR(32) NOT NULL,
        total_amount BIGINT NOT NULL,
        currency VARCHAR(3) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_orders_user_id ON orders.orders (user_id)`);
    await queryRunner.query(`CREATE INDEX idx_orders_status ON orders.orders (status)`);

    // ---- orders.order_items ----
    await queryRunner.query(`
      CREATE TABLE orders.order_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL REFERENCES orders.orders(id) ON DELETE CASCADE,
        product_id VARCHAR(64) NOT NULL,
        quantity INT NOT NULL CHECK (quantity > 0),
        unit_price BIGINT NOT NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_order_items_order_id ON orders.order_items (order_id)`);

    // ---- orders.order_events (audit / timeline) ----
    await queryRunner.query(`
      CREATE TABLE orders.order_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL REFERENCES orders.orders(id) ON DELETE CASCADE,
        event_type VARCHAR(64) NOT NULL,
        from_status VARCHAR(32),
        to_status VARCHAR(32),
        payload JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_order_events_order_id ON orders.order_events (order_id, created_at)`);

    // ---- payments.payments ----
    // Note: no FK to orders.orders — cross-schema FKs would tie the modules
    // together and defeat the "could split later" story. Consistency is
    // maintained via events, not database constraints.
    await queryRunner.query(`
      CREATE TABLE payments.payments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL,
        stripe_payment_intent_id VARCHAR(255) UNIQUE,
        status VARCHAR(32) NOT NULL,
        idempotency_key VARCHAR(255) NOT NULL UNIQUE,
        amount BIGINT NOT NULL,
        currency VARCHAR(3) NOT NULL,
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_payments_order_id ON payments.payments (order_id)`);

    // ---- payments.webhook_events (webhook idempotency ledger) ----
    // Stripe retries webhooks on non-2xx, so we may see the same event.id
    // multiple times. Recording it here lets us short-circuit reprocessing.
    await queryRunner.query(`
      CREATE TABLE payments.webhook_events (
        id VARCHAR(255) PRIMARY KEY,
        type VARCHAR(64) NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ---- inventory.inventory ----
    await queryRunner.query(`
      CREATE TABLE inventory.inventory (
        product_id VARCHAR(64) PRIMARY KEY,
        stock_quantity INT NOT NULL CHECK (stock_quantity >= 0),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ---- inventory.stock_adjustments (idempotency ledger for decrements) ----
    await queryRunner.query(`
      CREATE TABLE inventory.stock_adjustments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        idempotency_key VARCHAR(255) NOT NULL UNIQUE,
        order_id UUID NOT NULL,
        product_id VARCHAR(64) NOT NULL,
        delta INT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ---- notifications.notifications_log ----
    await queryRunner.query(`
      CREATE TABLE notifications.notifications_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID,
        type VARCHAR(64) NOT NULL,
        recipient VARCHAR(255),
        payload JSONB,
        sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_notifications_log_order_id ON notifications.notifications_log (order_id)`);

    // ---- outbox.outbox_events ----
    // Transactional outbox: producers write here in the same DB txn as the
    // business state change. A separate poller reads undispatched rows and
    // publishes them to the event bus, then marks dispatched_at. Guarantees
    // at-least-once delivery even if the broker is briefly unreachable.
    await queryRunner.query(`
      CREATE TABLE outbox.outbox_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        aggregate_type VARCHAR(64) NOT NULL,
        aggregate_id UUID NOT NULL,
        event_type VARCHAR(128) NOT NULL,
        payload JSONB NOT NULL,
        dispatched_at TIMESTAMPTZ,
        attempts INT NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_outbox_events_undispatched ON outbox.outbox_events (created_at) WHERE dispatched_at IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP SCHEMA IF EXISTS outbox CASCADE`);
    await queryRunner.query(`DROP SCHEMA IF EXISTS notifications CASCADE`);
    await queryRunner.query(`DROP SCHEMA IF EXISTS inventory CASCADE`);
    await queryRunner.query(`DROP SCHEMA IF EXISTS payments CASCADE`);
    await queryRunner.query(`DROP SCHEMA IF EXISTS orders CASCADE`);
    await queryRunner.query(`DROP SCHEMA IF EXISTS auth CASCADE`);
  }
}

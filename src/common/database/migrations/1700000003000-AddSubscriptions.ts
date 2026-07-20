import { MigrationInterface, QueryRunner } from 'typeorm';

// Adds the subscriptions bounded context. Kept in its own schema for the
// same reason as everything else — no cross-schema FKs, so `subscriptions`
// could split into its own service later.
//
// `auth.users.stripe_customer_id` is populated lazily on the user's first
// subscription attempt. We don't create Stripe customers eagerly on signup
// because most signups never buy anything.
export class AddSubscriptions1700000003000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS subscriptions`);

    await queryRunner.query(`
      ALTER TABLE auth.users
      ADD COLUMN stripe_customer_id VARCHAR(64) UNIQUE
    `);

    await queryRunner.query(`
      CREATE TABLE subscriptions.subscriptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        product_id VARCHAR(64) NOT NULL,
        stripe_subscription_id VARCHAR(64) NOT NULL UNIQUE,
        stripe_customer_id VARCHAR(64) NOT NULL,
        stripe_price_id VARCHAR(64) NOT NULL,
        status VARCHAR(32) NOT NULL,
        current_period_end TIMESTAMPTZ,
        cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
        latest_invoice_id VARCHAR(64),
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_subscriptions_user ON subscriptions.subscriptions (user_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_subscriptions_status ON subscriptions.subscriptions (status)`,
    );

    // Append-only audit trail, same shape as orders.order_events.
    await queryRunner.query(`
      CREATE TABLE subscriptions.subscription_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        subscription_id UUID NOT NULL REFERENCES subscriptions.subscriptions(id) ON DELETE CASCADE,
        event_type VARCHAR(64) NOT NULL,
        from_status VARCHAR(32),
        to_status VARCHAR(32),
        payload JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_subscription_events_sub ON subscriptions.subscription_events (subscription_id, created_at)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP SCHEMA IF EXISTS subscriptions CASCADE`);
    await queryRunner.query(`ALTER TABLE auth.users DROP COLUMN IF EXISTS stripe_customer_id`);
  }
}

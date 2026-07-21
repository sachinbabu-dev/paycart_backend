import { MigrationInterface, QueryRunner } from 'typeorm';

// Coupons live in their own schema — same rule the rest of the codebase
// follows: no cross-schema FKs, so `coupons` could split into its own service
// later. `coupon_redemptions.order_id` therefore has no FK to orders.orders;
// integrity is enforced at the app layer.
//
// Discounts are stored two ways:
//   - `percentage` — `value` is 1..100
//   - `fixed`      — `value` is a positive minor-unit amount (e.g. cents), and
//                    `currency` must be set so we can reject cross-currency use
//
// Redemption is idempotent per order via UNIQUE(order_id): the same order can
// never consume the same or two different coupons. The redemption row is what
// increments `coupons.redeemed_count`, both inside a single transaction.
export class AddCoupons1700000006000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS coupons`);

    await queryRunner.query(`
      CREATE TABLE coupons.coupons (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code VARCHAR(64) NOT NULL UNIQUE,
        type VARCHAR(16) NOT NULL CHECK (type IN ('percentage', 'fixed')),
        value INT NOT NULL CHECK (value > 0),
        currency VARCHAR(3),
        min_order_amount BIGINT CHECK (min_order_amount IS NULL OR min_order_amount >= 0),
        max_redemptions INT CHECK (max_redemptions IS NULL OR max_redemptions > 0),
        redeemed_count INT NOT NULL DEFAULT 0 CHECK (redeemed_count >= 0),
        valid_from TIMESTAMPTZ,
        valid_until TIMESTAMPTZ,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT percentage_value_range CHECK (
          type <> 'percentage' OR (value >= 1 AND value <= 100)
        ),
        CONSTRAINT fixed_requires_currency CHECK (
          type <> 'fixed' OR currency IS NOT NULL
        ),
        CONSTRAINT valid_window CHECK (
          valid_from IS NULL OR valid_until IS NULL OR valid_from < valid_until
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_coupons_active ON coupons.coupons (active)`,
    );

    await queryRunner.query(`
      CREATE TABLE coupons.coupon_redemptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        coupon_id UUID NOT NULL REFERENCES coupons.coupons(id) ON DELETE RESTRICT,
        order_id UUID NOT NULL UNIQUE,
        user_id UUID NOT NULL,
        discount_amount BIGINT NOT NULL CHECK (discount_amount > 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_coupon_redemptions_coupon ON coupons.coupon_redemptions (coupon_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_coupon_redemptions_user ON coupons.coupon_redemptions (user_id, coupon_id)`,
    );

    // Extend orders with the pricing breakdown. Historical rows had no
    // discount so backfill subtotal_amount = total_amount and discount = 0
    // before flipping subtotal_amount to NOT NULL.
    await queryRunner.query(
      `ALTER TABLE orders.orders ADD COLUMN subtotal_amount BIGINT`,
    );
    await queryRunner.query(
      `ALTER TABLE orders.orders ADD COLUMN discount_amount BIGINT NOT NULL DEFAULT 0 CHECK (discount_amount >= 0)`,
    );
    await queryRunner.query(
      `ALTER TABLE orders.orders ADD COLUMN coupon_code VARCHAR(64)`,
    );
    await queryRunner.query(
      `UPDATE orders.orders SET subtotal_amount = total_amount WHERE subtotal_amount IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE orders.orders ALTER COLUMN subtotal_amount SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE orders.orders ADD CONSTRAINT orders_total_matches_breakdown CHECK (total_amount = subtotal_amount - discount_amount)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE orders.orders DROP CONSTRAINT IF EXISTS orders_total_matches_breakdown`,
    );
    await queryRunner.query(`ALTER TABLE orders.orders DROP COLUMN IF EXISTS coupon_code`);
    await queryRunner.query(`ALTER TABLE orders.orders DROP COLUMN IF EXISTS discount_amount`);
    await queryRunner.query(`ALTER TABLE orders.orders DROP COLUMN IF EXISTS subtotal_amount`);
    await queryRunner.query(`DROP SCHEMA IF EXISTS coupons CASCADE`);
  }
}

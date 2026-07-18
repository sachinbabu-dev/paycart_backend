import { MigrationInterface, QueryRunner } from 'typeorm';

// Seed a small "specialty coffee roaster" catalog. The recurring row exists
// now so subscriptions have something to hang off when that module lands —
// POST /orders will reject it until then (one-time only).
export class AddProductsSchema1700000001000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS products`);

    await queryRunner.query(`
      CREATE TABLE products.products (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        sku VARCHAR(64) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        type VARCHAR(16) NOT NULL CHECK (type IN ('one_time', 'recurring')),
        unit_price BIGINT NOT NULL CHECK (unit_price >= 0),
        currency VARCHAR(3) NOT NULL,
        billing_interval VARCHAR(16) CHECK (billing_interval IS NULL OR billing_interval IN ('month', 'year')),
        stripe_product_id VARCHAR(64),
        stripe_price_id VARCHAR(64),
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT recurring_requires_interval CHECK (
          (type = 'recurring' AND billing_interval IS NOT NULL)
          OR (type = 'one_time' AND billing_interval IS NULL)
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX idx_products_active_type ON products.products (active, type)`,
    );

    // Also stock the inventory table so decrements have somewhere to land.
    // Recurring products intentionally get no inventory row.
    await queryRunner.query(`
      INSERT INTO products.products (sku, name, description, type, unit_price, currency)
      VALUES
        ('ethiopia-yirgacheffe-250g', 'Ethiopia Yirgacheffe (250g)', 'Bright, floral, citrus notes.', 'one_time', 1899, 'USD'),
        ('colombia-huila-250g',       'Colombia Huila (250g)',       'Milk chocolate, caramel, red apple.', 'one_time', 1799, 'USD'),
        ('guatemala-antigua-250g',    'Guatemala Antigua (250g)',    'Cocoa, hazelnut, toffee.',           'one_time', 1799, 'USD'),
        ('sampler-3pack',             'Roaster''s Sampler (3-pack)', 'One 100g bag from three origins.',   'one_time', 3499, 'USD')
    `);
    await queryRunner.query(`
      INSERT INTO products.products (sku, name, description, type, unit_price, currency, billing_interval)
      VALUES
        ('coffee-club-monthly', 'Coffee Club (Monthly)', 'A fresh 250g bag delivered every month.', 'recurring', 2199, 'USD', 'month')
    `);

    await queryRunner.query(`
      INSERT INTO inventory.inventory (product_id, stock_quantity)
      VALUES
        ('ethiopia-yirgacheffe-250g', 40),
        ('colombia-huila-250g',       40),
        ('guatemala-antigua-250g',    40),
        ('sampler-3pack',             20)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM inventory.inventory WHERE product_id IN ('ethiopia-yirgacheffe-250g','colombia-huila-250g','guatemala-antigua-250g','sampler-3pack')`,
    );
    await queryRunner.query(`DROP SCHEMA IF EXISTS products CASCADE`);
  }
}

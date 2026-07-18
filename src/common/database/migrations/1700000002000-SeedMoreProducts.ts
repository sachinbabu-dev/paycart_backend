import { MigrationInterface, QueryRunner } from 'typeorm';

// Extends the coffee catalog with bag-size variants, a decaf option, cold
// brew, and a small accessories line so the shop feels realistic and
// stock-management demos have more shape.
export class SeedMoreProducts1700000002000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO products.products (sku, name, description, type, unit_price, currency)
      VALUES
        ('ethiopia-yirgacheffe-500g',  'Ethiopia Yirgacheffe (500g)', 'Bright, floral, citrus notes. Larger bag.', 'one_time', 3299, 'USD'),
        ('decaf-brazil-cerrado-250g',  'Decaf Brazil Cerrado (250g)', 'Swiss Water decaf. Chocolate, almond, brown sugar.', 'one_time', 1899, 'USD'),
        ('cold-brew-concentrate-1l',   'Cold Brew Concentrate (1L)',  'Ready-to-dilute. Makes 8-10 servings.', 'one_time', 2499, 'USD'),
        ('hand-grinder-classic',       'Classic Hand Grinder',        'Steel burrs, adjustable grind. Ships worldwide.', 'one_time', 8999, 'USD'),
        ('pourover-dripper-v60',       'V60 Pour-over Dripper',       'Ceramic, size 02. Brews 1-4 cups.', 'one_time', 2899, 'USD'),
        ('paper-filters-100pack',      'V60 Paper Filters (100pk)',   'Unbleached, size 02.', 'one_time', 899, 'USD'),
        ('ceramic-mug-12oz',           'Roaster Ceramic Mug (12oz)',  'Matte glaze, dishwasher safe.', 'one_time', 1499, 'USD')
    `);

    await queryRunner.query(`
      INSERT INTO inventory.inventory (product_id, stock_quantity)
      VALUES
        ('ethiopia-yirgacheffe-500g',  25),
        ('decaf-brazil-cerrado-250g',  30),
        ('cold-brew-concentrate-1l',   15),
        ('hand-grinder-classic',        8),
        ('pourover-dripper-v60',       20),
        ('paper-filters-100pack',      60),
        ('ceramic-mug-12oz',           35)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const skus = [
      'ethiopia-yirgacheffe-500g',
      'decaf-brazil-cerrado-250g',
      'cold-brew-concentrate-1l',
      'hand-grinder-classic',
      'pourover-dripper-v60',
      'paper-filters-100pack',
      'ceramic-mug-12oz',
    ];
    const list = skus.map((s) => `'${s}'`).join(',');
    await queryRunner.query(`DELETE FROM inventory.inventory WHERE product_id IN (${list})`);
    await queryRunner.query(`DELETE FROM products.products WHERE sku IN (${list})`);
  }
}

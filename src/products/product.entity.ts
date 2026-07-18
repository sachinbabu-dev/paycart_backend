import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BillingInterval, ProductType } from './product-type';

@Entity({ schema: 'products', name: 'products' })
@Index(['active', 'type'])
export class ProductEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Stable, human-readable identifier. This is what flows across module
  // boundaries — order_items.product_id, inventory.product_id, and Stripe
  // metadata all reference the SKU string, not the surrogate UUID.
  @Column({ type: 'varchar', length: 64, unique: true })
  sku!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 16 })
  type!: ProductType;

  @Column({ name: 'unit_price', type: 'bigint' })
  unitPrice!: string;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({ name: 'billing_interval', type: 'varchar', length: 16, nullable: true })
  billingInterval!: BillingInterval | null;

  // Populated when the product is synced to Stripe. Nullable so we can seed
  // catalog rows before wiring the Stripe side; the subscriptions module will
  // enforce presence for recurring products at checkout time.
  @Column({ name: 'stripe_product_id', type: 'varchar', length: 64, nullable: true })
  stripeProductId!: string | null;

  @Column({ name: 'stripe_price_id', type: 'varchar', length: 64, nullable: true })
  stripePriceId!: string | null;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

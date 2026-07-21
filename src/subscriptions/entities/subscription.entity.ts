import {
  AfterLoad,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SubscriptionStatus } from '../subscription-status';

// First 8 chars of the UUID — enough uniqueness for a user-visible reference
// and matches how the id is shown in the header. Never use this for lookups;
// it isn't guaranteed unique across the whole table.
const SHORT_ID_LENGTH = 8;

@Entity({ schema: 'subscriptions', name: 'subscriptions' })
export class SubscriptionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  // SKU (matches products.products.sku). Kept as a string, not an FK — same
  // schema-boundary rule as orders.order_items.
  @Column({ name: 'product_id', type: 'varchar', length: 64 })
  productId!: string;

  @Column({ name: 'stripe_subscription_id', type: 'varchar', length: 64, unique: true })
  stripeSubscriptionId!: string;

  @Column({ name: 'stripe_customer_id', type: 'varchar', length: 64 })
  stripeCustomerId!: string;

  @Column({ name: 'stripe_price_id', type: 'varchar', length: 64 })
  stripePriceId!: string;

  @Index()
  @Column({ type: 'varchar', length: 32 })
  status!: SubscriptionStatus;

  @Column({ name: 'current_period_end', type: 'timestamptz', nullable: true })
  currentPeriodEnd!: Date | null;

  @Column({ name: 'cancel_at_period_end', type: 'boolean', default: false })
  cancelAtPeriodEnd!: boolean;

  @Column({ name: 'latest_invoice_id', type: 'varchar', length: 64, nullable: true })
  latestInvoiceId!: string | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  // Populated on load, not persisted. Assigning in @AfterLoad makes it an own
  // property so JSON.stringify (Nest's default serializer) picks it up.
  shortId!: string;

  @AfterLoad()
  private populateShortId(): void {
    this.shortId = this.id.slice(0, SHORT_ID_LENGTH);
  }
}

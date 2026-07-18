import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PaymentStatus } from '../payment-status';

@Entity({ schema: 'payments', name: 'payments' })
export class PaymentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // No FK to orders.orders — cross-schema FKs would tie the modules together
  // and defeat the "could split later" property. Referential integrity is
  // maintained via events, not database constraints.
  @Index()
  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @Column({
    name: 'stripe_payment_intent_id',
    type: 'varchar',
    length: 255,
    nullable: true,
    unique: true,
  })
  stripePaymentIntentId!: string | null;

  @Column({ type: 'varchar', length: 32 })
  status!: PaymentStatus;

  // Client-provided key for at-most-once payment creation. Unique index
  // enforces that retrying the same checkout call returns the same payment
  // instead of creating a duplicate Stripe Payment Intent.
  @Column({ name: 'idempotency_key', type: 'varchar', length: 255, unique: true })
  idempotencyKey!: string;

  @Column({ type: 'bigint' })
  amount!: string;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

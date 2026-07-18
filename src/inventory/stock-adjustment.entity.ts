import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

// Idempotency ledger. The event bus is at-least-once, so the same
// payment.succeeded event may arrive twice. Unique index on
// idempotency_key (composed as `${paymentId}:${productId}`) makes double
// decrements impossible even under redelivery.
@Entity({ schema: 'inventory', name: 'stock_adjustments' })
export class StockAdjustmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 255, unique: true })
  idempotencyKey!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @Column({ name: 'product_id', type: 'varchar', length: 64 })
  productId!: string;

  @Column({ type: 'int' })
  delta!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

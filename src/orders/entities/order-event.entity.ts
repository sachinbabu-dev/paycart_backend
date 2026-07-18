import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// Append-only audit trail of everything that happened to an order. Written
// alongside every status transition. Serves the /orders/:id/events endpoint
// and is the eventual data source for the realtime timeline UI.
@Entity({ schema: 'orders', name: 'order_events' })
export class OrderEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 64 })
  eventType!: string;

  @Column({ name: 'from_status', type: 'varchar', length: 32, nullable: true })
  fromStatus!: string | null;

  @Column({ name: 'to_status', type: 'varchar', length: 32, nullable: true })
  toStatus!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  payload!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

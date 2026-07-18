import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

// Ledger of Stripe webhook event IDs we've already processed. Stripe retries
// on non-2xx (and can rarely deliver the same event twice on 2xx), so we
// short-circuit reprocessing by rejecting rows whose PK we've already seen.
@Entity({ schema: 'payments', name: 'webhook_events' })
export class WebhookEventEntity {
  @PrimaryColumn({ type: 'varchar', length: 255 })
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  type!: string;

  @CreateDateColumn({ name: 'received_at', type: 'timestamptz' })
  receivedAt!: Date;
}

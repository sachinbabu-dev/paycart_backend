import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Repository } from 'typeorm';
import { EVENT_BUS, type EventBus } from '../event-bus/event-bus.interface';
import { OutboxEventEntity } from './outbox-event.entity';

const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 10;

// Polls the outbox table on a fixed interval and publishes undispatched rows
// to the event bus. This is the "publisher" half of the transactional outbox
// pattern. Chosen over PG LISTEN/NOTIFY for portfolio simplicity — trades a
// small dispatch latency for a much simpler mental model in interviews.
//
// At-least-once delivery: a row stays undispatched until the bus.publish call
// returns successfully. Subscribers must be idempotent.
@Injectable()
export class OutboxPublisher implements OnModuleInit {
  private readonly logger = new Logger(OutboxPublisher.name);
  private running = false;

  constructor(
    @InjectRepository(OutboxEventEntity)
    private readonly repo: Repository<OutboxEventEntity>,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    private readonly config: ConfigService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const intervalMs = this.config.get<number>('OUTBOX_POLL_INTERVAL_MS', 1000);
    const timer = setInterval(() => void this.tick(), intervalMs);
    this.scheduler.addInterval('outbox-publisher', timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const batch = await this.repo.find({
        where: { dispatchedAt: IsNull(), attempts: LessThan(MAX_ATTEMPTS) },
        order: { createdAt: 'ASC' },
        take: BATCH_SIZE,
      });
      if (batch.length === 0) return;

      for (const row of batch) {
        try {
          await this.bus.publish({
            type: row.eventType,
            aggregateId: row.aggregateId,
            payload: row.payload,
            occurredAt: row.createdAt,
          });
          row.dispatchedAt = new Date();
          row.lastError = null;
          await this.repo.save(row);
        } catch (err) {
          row.attempts += 1;
          row.lastError = (err as Error).message;
          await this.repo.save(row);
          this.logger.warn(
            `outbox dispatch failed for ${row.eventType} (${row.id}), attempt ${row.attempts}: ${row.lastError}`,
          );
        }
      }
    } catch (err) {
      this.logger.error('outbox publisher tick failed', err as Error);
    } finally {
      this.running = false;
    }
  }
}

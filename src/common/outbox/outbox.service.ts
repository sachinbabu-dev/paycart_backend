import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { OutboxEventEntity } from './outbox-event.entity';

export interface AppendOutboxInput {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

// Callers pass in the EntityManager from their active transaction so the
// outbox row is committed atomically with the business state change. If the
// txn rolls back, no orphan event is left behind; if it commits, the event is
// guaranteed to be picked up by the publisher.
@Injectable()
export class OutboxService {
  async append(manager: EntityManager, input: AppendOutboxInput): Promise<OutboxEventEntity> {
    const repo = manager.getRepository(OutboxEventEntity);
    const row = repo.create({
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      payload: input.payload,
    });
    return repo.save(row);
  }
}

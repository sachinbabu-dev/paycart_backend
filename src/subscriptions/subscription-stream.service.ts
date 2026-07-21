import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Observable, Subject, filter, from, map, merge, timer } from 'rxjs';
import {
  EVENT_BUS,
  type DomainEvent,
  type EventBus,
} from '../common/event-bus/event-bus.interface';
import { SubscriptionsService } from './subscriptions.service';

interface SubscriptionStreamMessage {
  data: unknown;
}

const KEEPALIVE_INTERVAL_MS = 15_000;

// Bridges the internal EventBus to per-subscription SSE streams. Mirrors
// OrderStreamService — a single bus subscription fans out via a Subject to any
// number of connected clients; each client filters for its own subscription id.
@Injectable()
export class SubscriptionStreamService implements OnModuleInit {
  private readonly events$ = new Subject<DomainEvent>();

  constructor(
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe('subscription.*', (e) =>
      this.events$.next(e as DomainEvent),
    );
  }

  forSubscription(
    subscriptionId: string,
    userId: string,
  ): Observable<SubscriptionStreamMessage> {
    const snapshot$ = from(this.buildSnapshot(subscriptionId, userId));

    const events$ = this.events$.pipe(
      filter((event) => this.matchesSubscription(event, subscriptionId)),
      map((event) => ({
        data: {
          kind: 'event',
          type: event.type,
          aggregateId: event.aggregateId,
          payload: event.payload,
          occurredAt: event.occurredAt,
        },
      })),
    );

    const keepalive$ = timer(KEEPALIVE_INTERVAL_MS, KEEPALIVE_INTERVAL_MS).pipe(
      map(() => ({ data: { kind: 'keepalive', ts: new Date().toISOString() } })),
    );

    return merge(snapshot$, events$, keepalive$);
  }

  private async buildSnapshot(
    subscriptionId: string,
    userId: string,
  ): Promise<SubscriptionStreamMessage> {
    // findByIdForUser throws 404 if the caller doesn't own the subscription —
    // turns into a 404 before the stream opens.
    const subscription = await this.subscriptions.findByIdForUser(
      subscriptionId,
      userId,
    );
    const events = await this.subscriptions.listEvents(subscriptionId, userId);
    return {
      data: {
        kind: 'snapshot',
        subscription,
        events,
      },
    };
  }

  private matchesSubscription(event: DomainEvent, subscriptionId: string): boolean {
    if (event.aggregateId === subscriptionId) return true;
    const payload = event.payload as { subscriptionId?: string } | undefined;
    return payload?.subscriptionId === subscriptionId;
  }
}

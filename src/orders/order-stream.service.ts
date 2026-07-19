import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Observable, Subject, filter, from, map, merge, of, timer } from 'rxjs';
import {
  EVENT_BUS,
  type DomainEvent,
  type EventBus,
} from '../common/event-bus/event-bus.interface';
import { OrdersService } from './orders.service';

interface OrderStreamMessage {
  data: unknown;
}

const KEEPALIVE_INTERVAL_MS = 15_000;

// Bridges the internal EventBus to per-order SSE streams.
//
// A single Subject fans out all `order.*` and `payment.*` events to any
// number of connected clients; each connection subscribes with a filter for
// its own order id. This means one bus subscription no matter how many
// clients — bus handlers stay O(1) as the client count grows.
@Injectable()
export class OrderStreamService implements OnModuleInit {
  private readonly events$ = new Subject<DomainEvent>();

  constructor(
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    private readonly orders: OrdersService,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe('order.*', (e) => this.events$.next(e as DomainEvent));
    this.bus.subscribe('payment.*', (e) => this.events$.next(e as DomainEvent));
  }

  // Returns an Observable in the shape Nest's @Sse() expects: each `data`
  // field is JSON-serialized and emitted as an SSE message. Prepends the
  // current order + recent history so a client works with a single request.
  // Merges a keepalive tick so idle proxies (Railway, Cloudflare, etc.)
  // don't kill the stream after their inactivity timeout.
  forOrder(orderId: string, userId: string): Observable<OrderStreamMessage> {
    const snapshot$ = from(this.buildSnapshot(orderId, userId));

    const events$ = this.events$.pipe(
      filter((event) => this.matchesOrder(event, orderId)),
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
    orderId: string,
    userId: string,
  ): Promise<OrderStreamMessage> {
    // findByIdForUser throws NotFoundException if the caller doesn't own the
    // order — that turns into a 404 before the stream even opens, which is
    // what we want.
    const order = await this.orders.findByIdForUser(orderId, userId);
    const events = await this.orders.listEvents(orderId, userId);
    return {
      data: {
        kind: 'snapshot',
        order,
        events,
      },
    };
  }

  private matchesOrder(event: DomainEvent, orderId: string): boolean {
    if (event.aggregateId === orderId) return true;
    const payload = event.payload as { orderId?: string } | undefined;
    return payload?.orderId === orderId;
  }

  // Fallback for tests / future use if we ever want to inject a fake bus.
  peek$(): Observable<DomainEvent> {
    return of();
  }
}

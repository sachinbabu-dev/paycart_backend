import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  EVENT_BUS,
  type DomainEvent,
  type EventBus,
} from '../common/event-bus/event-bus.interface';
import { OutboxService } from '../common/outbox/outbox.service';
import { OrderEntity } from '../orders/entities/order.entity';
import { OrdersService } from '../orders/orders.service';
import { ORDER_EVENT_TYPES } from '../orders/order-events';
import { OrderStatus } from '../orders/order-status';
import {
  PAYMENT_EVENT_TYPES,
  type PaymentSucceededPayload,
} from '../payments/payment-events';

// Simulates warehouse fulfillment:
//   1. On payment.succeeded → transition paid → preparing (instant).
//   2. A poller finds orders that have been in `preparing` for N seconds and
//      transitions them to `shipped`.
//
// Two design choices worth defending in interviews:
//
// - Cron poller (durable across restarts) instead of an in-process setTimeout.
//   A restart mid-delay would lose an in-process timer; the poller re-derives
//   what needs to ship from DB state every tick.
//
// - `FOR UPDATE SKIP LOCKED` on the shipper query — with two app instances
//   running, each tick grabs a disjoint slice of ready orders. Automatic
//   competitive-consumer, no leader election needed.
@Injectable()
export class FulfillmentService implements OnModuleInit {
  private readonly logger = new Logger(FulfillmentService.name);
  private running = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    private readonly orders: OrdersService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe<PaymentSucceededPayload>(
      PAYMENT_EVENT_TYPES.Succeeded,
      (event) => this.onPaymentSucceeded(event),
    );

    const intervalMs = this.config.get<number>(
      'FULFILLMENT_POLL_INTERVAL_MS',
      2000,
    );
    const timer = setInterval(() => void this.shipTick(), intervalMs);
    this.scheduler.addInterval('fulfillment-shipper', timer);
  }

  private async onPaymentSucceeded(
    event: DomainEvent<PaymentSucceededPayload>,
  ): Promise<void> {
    const { orderId, paymentId } = event.payload;

    // Pre-check outside the txn to avoid using exceptions for control flow
    // on at-least-once re-delivery. Only orders in `paid` should proceed.
    const order = await this.orders.findById(orderId);
    if (order.status !== OrderStatus.Paid) {
      this.logger.debug(
        `skip preparing transition for order ${orderId}: status is ${order.status}`,
      );
      return;
    }

    try {
      await this.dataSource.transaction(async (manager) => {
        await this.orders.transitionInTransaction(
          manager,
          orderId,
          OrderStatus.Preparing,
          ORDER_EVENT_TYPES.Preparing,
          { paymentId },
        );
        await this.outbox.append(manager, {
          aggregateType: 'order',
          aggregateId: orderId,
          eventType: ORDER_EVENT_TYPES.Preparing,
          payload: { orderId, paymentId },
        });
      });
    } catch (err) {
      // A racing cancellation or a re-delivered event that slipped past the
      // pre-check will land here as a BadRequestException from the state
      // machine. Swallow — the state has already moved on.
      if (err instanceof BadRequestException) {
        this.logger.debug(
          `preparing transition skipped for order ${orderId}: ${err.message}`,
        );
        return;
      }
      throw err;
    }
  }

  private async shipTick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const delaySeconds = this.config.get<number>(
        'FULFILLMENT_PREPARING_DELAY_SECONDS',
        10,
      );
      // Grab ready orders with SKIP LOCKED so multiple instances don't fight
      // over the same rows. Each candidate is shipped in its own transaction
      // — one bad row shouldn't stall the batch.
      const candidates: Array<{ id: string }> = await this.dataSource.query(
        `SELECT id FROM orders.orders
          WHERE status = $1
            AND updated_at <= NOW() - ($2 || ' seconds')::interval
          ORDER BY updated_at ASC
          LIMIT 50
          FOR UPDATE SKIP LOCKED`,
        [OrderStatus.Preparing, String(delaySeconds)],
      );
      for (const { id } of candidates) {
        try {
          await this.shipOne(id);
        } catch (err) {
          this.logger.warn(
            `ship failed for order ${id}: ${(err as Error).message}`,
          );
        }
      }
    } catch (err) {
      this.logger.error('shipper tick failed', err as Error);
    } finally {
      this.running = false;
    }
  }

  private async shipOne(orderId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      // Re-read under the txn's own lock. The SKIP LOCKED SELECT above ran in
      // its own auto-commit transaction; by the time we get here another
      // process could have shipped or cancelled the order. transitionInTransaction
      // takes a pessimistic_write lock and validates the transition — if it
      // throws, we log and move on.
      const order = await manager.findOne(OrderEntity, { where: { id: orderId } });
      if (!order || order.status !== OrderStatus.Preparing) return;

      await this.orders.transitionInTransaction(
        manager,
        orderId,
        OrderStatus.Shipped,
        ORDER_EVENT_TYPES.Shipped,
        {},
      );
      await this.outbox.append(manager, {
        aggregateType: 'order',
        aggregateId: orderId,
        eventType: ORDER_EVENT_TYPES.Shipped,
        payload: { orderId },
      });
    });
  }
}

import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  EVENT_BUS,
  type DomainEvent,
  type EventBus,
} from '../common/event-bus/event-bus.interface';
import {
  PAYMENT_EVENT_TYPES,
  type PaymentFailedPayload,
  type PaymentSucceededPayload,
} from '../payments/payment-events';
import { ORDER_EVENT_TYPES } from '../orders/order-events';
import { NotificationLogEntity } from './notification-log.entity';

// Simulated notification sink. In a real system this would hand off to
// Resend/SendGrid/Twilio; for the portfolio scope, logging + persisting the
// log row is enough to demo the event fan-out.
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(NotificationLogEntity)
    private readonly log: Repository<NotificationLogEntity>,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe<PaymentSucceededPayload>(
      PAYMENT_EVENT_TYPES.Succeeded,
      (e) => this.onPaymentSucceeded(e),
    );
    this.bus.subscribe<PaymentFailedPayload>(
      PAYMENT_EVENT_TYPES.Failed,
      (e) => this.onPaymentFailed(e),
    );
    this.bus.subscribe(ORDER_EVENT_TYPES.Shipped, (e) => this.onOrderShipped(e));
  }

  private async onPaymentSucceeded(
    event: DomainEvent<PaymentSucceededPayload>,
  ): Promise<void> {
    await this.record({
      orderId: event.payload.orderId,
      type: 'payment.succeeded',
      payload: event.payload as unknown as Record<string, unknown>,
    });
    this.logger.log(`[notify] payment succeeded for order ${event.payload.orderId}`);
  }

  private async onPaymentFailed(
    event: DomainEvent<PaymentFailedPayload>,
  ): Promise<void> {
    await this.record({
      orderId: event.payload.orderId,
      type: 'payment.failed',
      payload: event.payload as unknown as Record<string, unknown>,
    });
    this.logger.log(
      `[notify] payment failed for order ${event.payload.orderId}: ${event.payload.reason}`,
    );
  }

  private async onOrderShipped(event: DomainEvent): Promise<void> {
    const orderId =
      (event.payload as { orderId?: string } | undefined)?.orderId ?? event.aggregateId;
    await this.record({
      orderId,
      type: 'order.shipped',
      payload: event.payload as Record<string, unknown> | null,
    });
    this.logger.log(`[notify] order shipped: ${orderId}`);
  }

  private async record(input: {
    orderId: string | null;
    type: string;
    payload: Record<string, unknown> | null;
  }): Promise<void> {
    await this.log.save(
      this.log.create({
        orderId: input.orderId,
        type: input.type,
        payload: input.payload,
      }),
    );
  }
}

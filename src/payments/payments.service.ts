import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import Stripe from 'stripe';
import { DataSource, Repository } from 'typeorm';
import { OutboxService } from '../common/outbox/outbox.service';
import { OrderEventEntity } from '../orders/entities/order-event.entity';
import { OrderEntity } from '../orders/entities/order.entity';
import { OrdersService } from '../orders/orders.service';
import { OrderStatus } from '../orders/order-status';
import { ORDER_EVENT_TYPES } from '../orders/order-events';
import { PaymentEntity } from './entities/payment.entity';
import { WebhookEventEntity } from './entities/webhook-event.entity';
import {
  PAYMENT_EVENT_TYPES,
  type PaymentFailedPayload,
  type PaymentSucceededPayload,
} from './payment-events';
import { PaymentStatus } from './payment-status';
import { StripeService } from './stripe.service';

export interface CheckoutResult {
  paymentId: string;
  clientSecret: string;
  status: PaymentStatus;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(PaymentEntity) private readonly payments: Repository<PaymentEntity>,
    @InjectRepository(WebhookEventEntity)
    private readonly webhookEvents: Repository<WebhookEventEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly stripe: StripeService,
    private readonly orders: OrdersService,
    private readonly outbox: OutboxService,
  ) {}

  async checkout(params: {
    orderId: string;
    userId: string;
    idempotencyKey: string;
  }): Promise<CheckoutResult> {
    if (!params.idempotencyKey || params.idempotencyKey.trim().length === 0) {
      throw new BadRequestException('Idempotency-Key header required');
    }

    // Replay protection: if we've already seen this key, return the prior
    // result rather than creating a new PaymentIntent. This is safe because
    // Stripe's own idempotency mechanism would return the same PI anyway;
    // short-circuiting here just avoids a needless network round-trip.
    const existing = await this.payments.findOne({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (existing) {
      if (existing.orderId !== params.orderId) {
        throw new ConflictException('idempotency key reused with different order');
      }
      const pi = existing.stripePaymentIntentId
        ? await this.retrieveIntent(existing.stripePaymentIntentId)
        : null;
      return {
        paymentId: existing.id,
        clientSecret: pi?.client_secret ?? '',
        status: existing.status,
      };
    }

    const order = await this.orders.findByIdForUser(params.orderId, params.userId);
    if (order.status !== OrderStatus.Pending && order.status !== OrderStatus.Failed) {
      throw new BadRequestException(
        `order not in a checkoutable state: ${order.status}`,
      );
    }

    const intent = await this.stripe.createPaymentIntent({
      amount: Number(order.totalAmount),
      currency: order.currency,
      idempotencyKey: params.idempotencyKey,
      orderId: order.id,
    });

    // Payment row + order transition to payment_pending + outbox row all in
    // one transaction — either the whole thing commits or none of it does.
    return this.dataSource.transaction(async (manager) => {
      const payment = manager.create(PaymentEntity, {
        orderId: order.id,
        stripePaymentIntentId: intent.id,
        status: mapIntentStatus(intent.status),
        idempotencyKey: params.idempotencyKey,
        amount: order.totalAmount,
        currency: order.currency,
      });
      const saved = await manager.save(payment);

      await this.orders.transitionInTransaction(
        manager,
        order.id,
        OrderStatus.PaymentPending,
        ORDER_EVENT_TYPES.PaymentPending,
        { paymentId: saved.id, stripePaymentIntentId: intent.id },
      );

      return {
        paymentId: saved.id,
        clientSecret: intent.client_secret ?? '',
        status: saved.status,
      };
    });
  }

  // Webhook handler. Called by the controller after signature verification.
  // Everything that follows is at-least-once from Stripe's side; the
  // webhook_events ledger + outbox make our side safe against replays.
  async handleWebhookEvent(event: Stripe.Event): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      // Insert-or-skip: if this event.id is already recorded, bail out. The
      // outer transaction rolls back everything if the insert conflicts.
      const seen = await manager.findOne(WebhookEventEntity, {
        where: { id: event.id },
      });
      if (seen) {
        this.logger.log(`webhook ${event.id} already processed, skipping`);
        return;
      }
      await manager.save(
        manager.create(WebhookEventEntity, { id: event.id, type: event.type }),
      );

      switch (event.type) {
        case 'payment_intent.succeeded':
          await this.onPaymentIntentSucceeded(
            manager,
            event.data.object as Stripe.PaymentIntent,
          );
          break;
        case 'payment_intent.payment_failed':
          await this.onPaymentIntentFailed(
            manager,
            event.data.object as Stripe.PaymentIntent,
          );
          break;
        default:
          // Unhandled event types are still recorded in webhook_events so
          // Stripe stops retrying; ignore the body.
          this.logger.debug(`ignoring unhandled event type: ${event.type}`);
      }
    });
  }

  private async onPaymentIntentSucceeded(
    manager: import('typeorm').EntityManager,
    intent: Stripe.PaymentIntent,
  ): Promise<void> {
    const payment = await manager.findOne(PaymentEntity, {
      where: { stripePaymentIntentId: intent.id },
    });
    if (!payment) {
      this.logger.warn(`no local payment found for intent ${intent.id}`);
      return;
    }
    if (payment.status === PaymentStatus.Succeeded) return;

    payment.status = PaymentStatus.Succeeded;
    payment.lastError = null;
    await manager.save(payment);

    const order = await this.orders.transitionInTransaction(
      manager,
      payment.orderId,
      OrderStatus.Paid,
      ORDER_EVENT_TYPES.Paid,
      { paymentId: payment.id, stripePaymentIntentId: intent.id },
    );

    // Read items via the orders repo through the same txn manager so we can
    // include them in the event without breaking module boundaries — we're
    // reading rows that already belong to the order aggregate.
    const orderWithItems = await manager.findOne(OrderEntity, {
      where: { id: order.id },
      relations: { items: true },
    });

    const payload: PaymentSucceededPayload = {
      paymentId: payment.id,
      orderId: payment.orderId,
      amount: payment.amount,
      currency: payment.currency,
      stripePaymentIntentId: intent.id,
      items:
        orderWithItems?.items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
        })) ?? [],
    };

    // Outbox write in the SAME transaction. If any of the above fails after
    // this point, the whole txn rolls back and the event is never dispatched.
    // If it commits, the poller guarantees delivery.
    await this.outbox.append(manager, {
      aggregateType: 'payment',
      aggregateId: payment.id,
      eventType: PAYMENT_EVENT_TYPES.Succeeded,
      payload: payload as unknown as Record<string, unknown>,
    });
  }

  private async onPaymentIntentFailed(
    manager: import('typeorm').EntityManager,
    intent: Stripe.PaymentIntent,
  ): Promise<void> {
    const payment = await manager.findOne(PaymentEntity, {
      where: { stripePaymentIntentId: intent.id },
    });
    if (!payment) return;
    if (payment.status === PaymentStatus.Failed) return;

    const reason = intent.last_payment_error?.message ?? 'payment failed';
    payment.status = PaymentStatus.Failed;
    payment.lastError = reason;
    await manager.save(payment);

    await this.orders.transitionInTransaction(
      manager,
      payment.orderId,
      OrderStatus.Failed,
      ORDER_EVENT_TYPES.Failed,
      { paymentId: payment.id, reason },
    );

    const payload: PaymentFailedPayload = {
      paymentId: payment.id,
      orderId: payment.orderId,
      reason,
      stripePaymentIntentId: intent.id,
    };

    await this.outbox.append(manager, {
      aggregateType: 'payment',
      aggregateId: payment.id,
      eventType: PAYMENT_EVENT_TYPES.Failed,
      payload: payload as unknown as Record<string, unknown>,
    });
  }

  async findByIdForUser(id: string, userId: string): Promise<PaymentEntity> {
    const payment = await this.payments.findOne({ where: { id } });
    if (!payment) throw new NotFoundException('payment not found');
    const order = await this.orders.findById(payment.orderId);
    if (order.userId !== userId) throw new NotFoundException('payment not found');
    return payment;
  }

  private async retrieveIntent(id: string): Promise<Stripe.PaymentIntent | null> {
    try {
      return await this.stripe.retrievePaymentIntent(id);
    } catch (err) {
      this.logger.warn(`retrieve intent ${id} failed`, err as Error);
      return null;
    }
  }
}

function mapIntentStatus(status: Stripe.PaymentIntent.Status): PaymentStatus {
  switch (status) {
    case 'succeeded':
      return PaymentStatus.Succeeded;
    case 'processing':
      return PaymentStatus.Processing;
    case 'canceled':
      return PaymentStatus.Cancelled;
    case 'requires_payment_method':
    case 'requires_confirmation':
    case 'requires_action':
    case 'requires_capture':
      return PaymentStatus.RequiresAction;
    default:
      return PaymentStatus.Processing;
  }
}

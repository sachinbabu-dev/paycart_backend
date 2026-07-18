import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import Stripe from 'stripe';
import { DataSource, In, QueryFailedError, Repository } from 'typeorm';
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

const UNIQUE_VIOLATION = '23505';

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

    // Fast path: if we've already seen this idempotency key, return the prior
    // result without any Stripe I/O. Same key + same order = same payment.
    const seen = await this.payments.findOne({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (seen) {
      if (seen.orderId !== params.orderId) {
        throw new ConflictException('idempotency key reused with different order');
      }
      return this.hydrateResult(seen);
    }

    // Serialize concurrent checkouts on the same order. Two clicks in quick
    // succession would otherwise both see "no in-flight payment", both call
    // Stripe, and race to insert — violating either the idempotency_key or
    // stripe_payment_intent_id unique index. The lock ensures whichever
    // request loses the race sees the winner's payment and returns it.
    const active = await this.dataSource.transaction(async (manager) => {
      const order = await manager
        .createQueryBuilder(OrderEntity, 'o')
        .setLock('pessimistic_write')
        .where('o.id = :id', { id: params.orderId })
        .getOne();
      if (!order || order.userId !== params.userId) {
        throw new NotFoundException('order not found');
      }
      if (
        order.status !== OrderStatus.Pending &&
        order.status !== OrderStatus.Failed
      ) {
        throw new BadRequestException(
          `order not in a checkoutable state: ${order.status}`,
        );
      }
      const activePayment = await manager.findOne(PaymentEntity, {
        where: {
          orderId: order.id,
          status: In([PaymentStatus.RequiresAction, PaymentStatus.Processing]),
        },
      });
      return { order, activePayment };
    });

    if (active.activePayment) return this.hydrateResult(active.activePayment);

    // Stripe call outside the txn — it can take a second or two and we don't
    // want to hold the order-row lock that long. The `idempotencyKey` passed
    // through is Stripe's own dedup mechanism, so this call itself is safe
    // to retry from Stripe's side.
    const intent = await this.stripe.createPaymentIntent({
      amount: Number(active.order.totalAmount),
      currency: active.order.currency,
      idempotencyKey: params.idempotencyKey,
      orderId: active.order.id,
    });

    try {
      return await this.dataSource.transaction(async (manager) => {
        const payment = manager.create(PaymentEntity, {
          orderId: active.order.id,
          stripePaymentIntentId: intent.id,
          status: mapIntentStatus(intent.status),
          idempotencyKey: params.idempotencyKey,
          amount: active.order.totalAmount,
          currency: active.order.currency,
        });
        const saved = await manager.save(payment);

        await this.orders.transitionInTransaction(
          manager,
          active.order.id,
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
    } catch (err) {
      // Belt-and-braces for the race the lock is supposed to prevent. If
      // another request beat us to inserting this stripe_payment_intent_id
      // (or somehow the same idempotency_key), look up the winner and return
      // its result rather than surfacing a 500 to a client that did nothing
      // wrong.
      if (
        err instanceof QueryFailedError &&
        (err as unknown as { code?: string }).code === UNIQUE_VIOLATION
      ) {
        const winner =
          (await this.payments.findOne({
            where: { stripePaymentIntentId: intent.id },
          })) ??
          (await this.payments.findOne({
            where: { idempotencyKey: params.idempotencyKey },
          }));
        if (winner) {
          this.logger.warn(
            `checkout race resolved by returning existing payment ${winner.id}`,
          );
          return {
            paymentId: winner.id,
            clientSecret: intent.client_secret ?? '',
            status: winner.status,
          };
        }
      }
      throw err;
    }
  }

  private async hydrateResult(payment: PaymentEntity): Promise<CheckoutResult> {
    const pi = payment.stripePaymentIntentId
      ? await this.retrieveIntent(payment.stripePaymentIntentId)
      : null;
    return {
      paymentId: payment.id,
      clientSecret: pi?.client_secret ?? '',
      status: payment.status,
    };
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

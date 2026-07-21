import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import Stripe from 'stripe';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { UserEntity } from '../auth/user.entity';
import { OutboxService } from '../common/outbox/outbox.service';
import { StripeService } from '../payments/stripe.service';
import { ProductEntity } from '../products/product.entity';
import { BillingInterval, ProductType } from '../products/product-type';
import { ProductsService } from '../products/products.service';
import { SubscriptionEventEntity } from './entities/subscription-event.entity';
import { SubscriptionEntity } from './entities/subscription.entity';
import { SubscriptionStateMachine } from './subscription-state-machine';
import { SubscriptionStatus } from './subscription-status';
import {
  SUBSCRIPTION_EVENT_TYPES,
  type SubscriptionActivatedPayload,
  type SubscriptionCanceledPayload,
  type SubscriptionPaymentFailedPayload,
} from './subscription-events';

export interface SubscribeResult {
  subscriptionId: string;
  stripeSubscriptionId: string;
  status: SubscriptionStatus;
  // client_secret from the incomplete invoice's PaymentIntent. Client passes
  // this to Stripe.js Payment Element to activate the subscription.
  clientSecret: string | null;
}

@Injectable()
export class SubscriptionsService implements OnModuleInit {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    @InjectRepository(SubscriptionEntity)
    private readonly subscriptions: Repository<SubscriptionEntity>,
    @InjectRepository(SubscriptionEventEntity)
    private readonly subscriptionEvents: Repository<SubscriptionEventEntity>,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(ProductEntity)
    private readonly products: Repository<ProductEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly productsService: ProductsService,
    private readonly stripe: StripeService,
    private readonly outbox: OutboxService,
  ) {}

  // Boot-time Stripe sync: for any recurring product row that hasn't been
  // pushed to Stripe yet (no stripe_price_id), create the Product + Price
  // and store the IDs. Idempotent via Stripe's price lookup_key.
  //
  // Runs once per boot. Failures log and swallow — the app should still come
  // up even if Stripe is temporarily unavailable; a later subscription attempt
  // will re-attempt the sync on demand (see ensurePriceIdOrThrow below).
  async onModuleInit(): Promise<void> {
    const unsynced = await this.products.find({
      where: { type: ProductType.Recurring },
    });
    for (const product of unsynced) {
      if (product.stripePriceId) continue;
      try {
        await this.syncProductToStripe(product);
      } catch (err) {
        this.logger.warn(
          `stripe sync failed for ${product.sku}: ${(err as Error).message}`,
        );
      }
    }
  }

  async subscribe(params: {
    userId: string;
    userEmail: string;
    productSku: string;
    idempotencyKey: string;
  }): Promise<SubscribeResult> {
    if (!params.idempotencyKey || params.idempotencyKey.trim().length === 0) {
      throw new BadRequestException('Idempotency-Key header required');
    }

    const product = await this.productsService.findBySku(params.productSku);
    if (product.type !== ProductType.Recurring) {
      throw new BadRequestException(
        `${product.sku} is not a recurring product`,
      );
    }
    if (!product.active) {
      throw new BadRequestException(`${product.sku} is not active`);
    }
    const priceId = await this.ensurePriceIdOrThrow(product);
    const customerId = await this.ensureStripeCustomer(
      params.userId,
      params.userEmail,
    );

    const stripeSub = await this.stripe.createSubscription({
      customerId,
      priceId,
      userId: params.userId,
      productSku: product.sku,
      idempotencyKey: params.idempotencyKey,
    });

    return this.dataSource.transaction(async (manager) => {
      // Insert-or-update: with the same Stripe idempotency key, the same
      // stripe subscription id comes back on retry. Unique index on
      // stripe_subscription_id turns re-runs into no-ops rather than dupes.
      let sub = await manager.findOne(SubscriptionEntity, {
        where: { stripeSubscriptionId: stripeSub.id },
      });
      if (!sub) {
        sub = manager.create(SubscriptionEntity, {
          userId: params.userId,
          productId: product.sku,
          stripeSubscriptionId: stripeSub.id,
          stripeCustomerId: customerId,
          stripePriceId: priceId,
          status: stripeSub.status as SubscriptionStatus,
          currentPeriodEnd: toDate(stripeSub.current_period_end),
          cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
          latestInvoiceId:
            typeof stripeSub.latest_invoice === 'string'
              ? stripeSub.latest_invoice
              : stripeSub.latest_invoice?.id ?? null,
        });
        sub = await manager.save(sub);
        await this.recordEvent(manager, {
          subscriptionId: sub.id,
          eventType: SUBSCRIPTION_EVENT_TYPES.Created,
          toStatus: sub.status,
          payload: { stripeSubscriptionId: sub.stripeSubscriptionId },
        });
        await this.outbox.append(manager, {
          aggregateType: 'subscription',
          aggregateId: sub.id,
          eventType: SUBSCRIPTION_EVENT_TYPES.Created,
          payload: {
            subscriptionId: sub.id,
            userId: sub.userId,
            productId: sub.productId,
            stripeSubscriptionId: sub.stripeSubscriptionId,
          },
        });
      }

      return {
        subscriptionId: sub.id,
        stripeSubscriptionId: sub.stripeSubscriptionId,
        status: sub.status,
        clientSecret: extractClientSecret(stripeSub),
      };
    });
  }

  async cancel(
    subscriptionId: string,
    userId: string,
    opts: { immediately?: boolean } = {},
  ): Promise<SubscriptionEntity> {
    const sub = await this.findByIdForUser(subscriptionId, userId);
    if (sub.status === SubscriptionStatus.Canceled) return sub;

    const updated = await this.stripe.cancelSubscription(sub.stripeSubscriptionId, opts);
    sub.cancelAtPeriodEnd = updated.cancel_at_period_end;
    if (updated.status !== sub.status) {
      SubscriptionStateMachine.assertTransition(
        sub.status,
        updated.status as SubscriptionStatus,
      );
      sub.status = updated.status as SubscriptionStatus;
    }
    return this.subscriptions.save(sub);
    // Full audit + outbox happen on the resulting `customer.subscription.updated`
    // or `customer.subscription.deleted` webhook — Stripe is the source of truth.
  }

  async findByIdForUser(id: string, userId: string): Promise<SubscriptionEntity> {
    const sub = await this.subscriptions.findOne({ where: { id } });
    if (!sub || sub.userId !== userId) {
      throw new NotFoundException('subscription not found');
    }
    return sub;
  }

  listForUser(userId: string): Promise<SubscriptionEntity[]> {
    return this.subscriptions.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async listEvents(
    subscriptionId: string,
    userId: string,
  ): Promise<SubscriptionEventEntity[]> {
    await this.findByIdForUser(subscriptionId, userId);
    return this.subscriptionEvents.find({
      where: { subscriptionId },
      order: { createdAt: 'ASC' },
    });
  }

  // ---- Webhook handlers, called from PaymentsService.handleWebhookEvent ----

  async onInvoicePaid(
    manager: EntityManager,
    invoice: Stripe.Invoice,
  ): Promise<void> {
    const subId = invoiceSubscriptionId(invoice);
    if (!subId) return;
    const sub = await manager.findOne(SubscriptionEntity, {
      where: { stripeSubscriptionId: subId },
    });
    if (!sub) {
      this.logger.warn(`invoice.paid for unknown subscription ${subId}`);
      return;
    }
    const wasActive = sub.status === SubscriptionStatus.Active;
    if (!wasActive) {
      SubscriptionStateMachine.assertTransition(sub.status, SubscriptionStatus.Active);
      await this.transition(manager, sub, SubscriptionStatus.Active, {
        invoiceId: invoice.id,
      });
      const payload: SubscriptionActivatedPayload = {
        subscriptionId: sub.id,
        userId: sub.userId,
        productId: sub.productId,
        stripeSubscriptionId: sub.stripeSubscriptionId,
      };
      await this.outbox.append(manager, {
        aggregateType: 'subscription',
        aggregateId: sub.id,
        eventType: SUBSCRIPTION_EVENT_TYPES.Activated,
        payload: payload as unknown as Record<string, unknown>,
      });
    }
  }

  async onInvoicePaymentFailed(
    manager: EntityManager,
    invoice: Stripe.Invoice,
  ): Promise<void> {
    const subId = invoiceSubscriptionId(invoice);
    if (!subId) return;
    const sub = await manager.findOne(SubscriptionEntity, {
      where: { stripeSubscriptionId: subId },
    });
    if (!sub) return;
    const reason =
      invoice.last_finalization_error?.message ??
      'subscription payment failed';
    if (SubscriptionStateMachine.canTransition(sub.status, SubscriptionStatus.PastDue)) {
      await this.transition(manager, sub, SubscriptionStatus.PastDue, {
        invoiceId: invoice.id,
        reason,
      });
    }
    sub.lastError = reason;
    await manager.save(sub);
    const payload: SubscriptionPaymentFailedPayload = {
      subscriptionId: sub.id,
      userId: sub.userId,
      productId: sub.productId,
      reason,
    };
    await this.outbox.append(manager, {
      aggregateType: 'subscription',
      aggregateId: sub.id,
      eventType: SUBSCRIPTION_EVENT_TYPES.PaymentFailed,
      payload: payload as unknown as Record<string, unknown>,
    });
  }

  async onSubscriptionUpdated(
    manager: EntityManager,
    stripeSub: Stripe.Subscription,
  ): Promise<void> {
    const sub = await manager.findOne(SubscriptionEntity, {
      where: { stripeSubscriptionId: stripeSub.id },
    });
    if (!sub) return;
    await this.applyStripeSubscription(manager, sub, stripeSub, 'stripe.updated');
  }

  // Reconciliation entry point. Pulls the current subscription from Stripe and
  // applies it locally — the pull-based counterpart to the push-based webhook.
  // Justification: Stripe webhooks are best-effort. Events can arrive out of
  // order, be delayed for minutes, or be dropped entirely if our endpoint is
  // down long enough that Stripe gives up retrying. Any long-lived Stripe
  // integration needs a "just re-read the truth" path in addition to webhooks.
  //
  // Uses the exact same apply logic as the webhook handler so behavior is
  // identical whether the trigger was push or pull: same state-machine gate,
  // same outbox event (so SSE clients see the sync happen live).
  async syncFromStripe(
    subscriptionId: string,
    userId: string,
  ): Promise<SubscriptionEntity> {
    const local = await this.findByIdForUser(subscriptionId, userId);
    const stripeSub = await this.stripe.retrieveSubscription(
      local.stripeSubscriptionId,
    );
    return this.dataSource.transaction(async (manager) => {
      // Re-read in-txn so we own the row while updating.
      const sub = await manager.findOne(SubscriptionEntity, {
        where: { id: local.id },
      });
      if (!sub) throw new NotFoundException('subscription not found');
      await this.applyStripeSubscription(manager, sub, stripeSub, 'sync');
      return sub;
    });
  }

  private async applyStripeSubscription(
    manager: EntityManager,
    sub: SubscriptionEntity,
    stripeSub: Stripe.Subscription,
    source: 'stripe.updated' | 'sync',
  ): Promise<void> {
    const newStatus = stripeSub.status as SubscriptionStatus;
    sub.cancelAtPeriodEnd = stripeSub.cancel_at_period_end;
    sub.currentPeriodEnd = toDate(stripeSub.current_period_end);
    if (sub.status !== newStatus) {
      if (SubscriptionStateMachine.canTransition(sub.status, newStatus)) {
        await this.transition(manager, sub, newStatus, { source });
      } else {
        // Stripe told us something the state machine considers illegal.
        // Log and don't force the transition — most likely a race that a
        // later webhook will reconcile. Still update the non-status fields.
        this.logger.warn(
          `refusing illegal transition ${sub.status} -> ${newStatus} for ${sub.id}`,
        );
        await manager.save(sub);
      }
    } else {
      await manager.save(sub);
    }
    await this.outbox.append(manager, {
      aggregateType: 'subscription',
      aggregateId: sub.id,
      eventType: SUBSCRIPTION_EVENT_TYPES.Updated,
      payload: {
        subscriptionId: sub.id,
        userId: sub.userId,
        productId: sub.productId,
        status: sub.status,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        source,
      },
    });
  }

  async onSubscriptionDeleted(
    manager: EntityManager,
    stripeSub: Stripe.Subscription,
  ): Promise<void> {
    const sub = await manager.findOne(SubscriptionEntity, {
      where: { stripeSubscriptionId: stripeSub.id },
    });
    if (!sub) return;
    if (sub.status === SubscriptionStatus.Canceled) return;
    await this.transition(manager, sub, SubscriptionStatus.Canceled, {
      source: 'stripe.deleted',
    });
    const payload: SubscriptionCanceledPayload = {
      subscriptionId: sub.id,
      userId: sub.userId,
      productId: sub.productId,
      canceledAt: new Date().toISOString(),
    };
    await this.outbox.append(manager, {
      aggregateType: 'subscription',
      aggregateId: sub.id,
      eventType: SUBSCRIPTION_EVENT_TYPES.Canceled,
      payload: payload as unknown as Record<string, unknown>,
    });
  }

  // ---- Internals ----

  private async transition(
    manager: EntityManager,
    sub: SubscriptionEntity,
    to: SubscriptionStatus,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const from = sub.status;
    sub.status = to;
    await manager.save(sub);
    await this.recordEvent(manager, {
      subscriptionId: sub.id,
      eventType: `subscription.${to}`,
      fromStatus: from,
      toStatus: to,
      payload,
    });
  }

  private async recordEvent(
    manager: EntityManager,
    input: {
      subscriptionId: string;
      eventType: string;
      fromStatus?: SubscriptionStatus;
      toStatus?: SubscriptionStatus;
      payload?: Record<string, unknown>;
    },
  ): Promise<void> {
    await manager.save(
      manager.create(SubscriptionEventEntity, {
        subscriptionId: input.subscriptionId,
        eventType: input.eventType,
        fromStatus: input.fromStatus ?? null,
        toStatus: input.toStatus ?? null,
        payload: input.payload ?? null,
      }),
    );
  }

  private async ensureStripeCustomer(
    userId: string,
    email: string,
  ): Promise<string> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('user not found');
    if (user.stripeCustomerId) return user.stripeCustomerId;
    const customer = await this.stripe.createCustomer({ userId, email });
    user.stripeCustomerId = customer.id;
    try {
      await this.users.save(user);
    } catch (err) {
      // Concurrent subscribe: another request already stored a customer id.
      // Re-read and use whichever one won.
      const fresh = await this.users.findOne({ where: { id: userId } });
      if (fresh?.stripeCustomerId) return fresh.stripeCustomerId;
      throw err;
    }
    return customer.id;
  }

  private async ensurePriceIdOrThrow(product: ProductEntity): Promise<string> {
    if (product.stripePriceId) return product.stripePriceId;
    // Fallback in case boot-time sync failed or the product row was inserted
    // after boot. On-demand sync is expensive (network + DB write), so it's
    // gated behind "we actually need this price to subscribe."
    const { productId, priceId } = await this.syncProductToStripe(product);
    if (productId && priceId) return priceId;
    throw new ConflictException(
      `product ${product.sku} not yet synced to Stripe`,
    );
  }

  private async syncProductToStripe(
    product: ProductEntity,
  ): Promise<{ productId: string; priceId: string }> {
    if (!product.billingInterval) {
      throw new BadRequestException(
        `recurring product ${product.sku} missing billing_interval`,
      );
    }
    const interval: 'month' | 'year' =
      product.billingInterval === BillingInterval.Year ? 'year' : 'month';
    const result = await this.stripe.ensureProductAndPrice({
      sku: product.sku,
      name: product.name,
      unitPrice: Number(product.unitPrice),
      currency: product.currency,
      interval,
    });
    product.stripeProductId = result.productId;
    product.stripePriceId = result.priceId;
    await this.products.save(product);
    this.logger.log(
      `synced ${product.sku} to stripe: ${result.productId} / ${result.priceId}`,
    );
    return result;
  }
}

// ---- helpers ----

function toDate(unixSeconds: number | null | undefined): Date | null {
  return unixSeconds ? new Date(unixSeconds * 1000) : null;
}

function extractClientSecret(sub: Stripe.Subscription): string | null {
  const invoice = sub.latest_invoice;
  if (!invoice || typeof invoice === 'string') return null;
  const pi = invoice.payment_intent;
  if (!pi || typeof pi === 'string') return null;
  return pi.client_secret ?? null;
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const sub = invoice.subscription;
  if (!sub) return null;
  return typeof sub === 'string' ? sub : sub.id;
}

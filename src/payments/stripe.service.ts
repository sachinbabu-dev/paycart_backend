import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

// Thin wrapper around the Stripe SDK so no other module ever imports Stripe
// directly. Keeps the payments module the sole owner of the Stripe boundary
// — a testable seam and an easy story for interviews.
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;

  constructor(config: ConfigService) {
    this.stripe = new Stripe(config.getOrThrow<string>('STRIPE_SECRET_KEY'), {
      // Pin to the API version the installed SDK targets. Update this in
      // lockstep with the stripe package to avoid silent behaviour changes.
      apiVersion: '2025-02-24.acacia',
      typescript: true,
    });
    this.webhookSecret = config.getOrThrow<string>('STRIPE_WEBHOOK_SECRET');
  }

  async createPaymentIntent(params: {
    amount: number;
    currency: string;
    idempotencyKey: string;
    orderId: string;
  }): Promise<Stripe.PaymentIntent> {
    return this.stripe.paymentIntents.create(
      {
        amount: params.amount,
        currency: params.currency.toLowerCase(),
        automatic_payment_methods: { enabled: true },
        metadata: { order_id: params.orderId },
      },
      // Stripe's own Idempotency-Key mechanism: the same key returns the same
      // PaymentIntent even on retry, so a client that resends the checkout
      // request never causes double-charging.
      { idempotencyKey: params.idempotencyKey },
    );
  }

  retrievePaymentIntent(id: string): Promise<Stripe.PaymentIntent> {
    return this.stripe.paymentIntents.retrieve(id);
  }

  // ---- Customers ----

  createCustomer(params: {
    userId: string;
    email: string;
  }): Promise<Stripe.Customer> {
    return this.stripe.customers.create({
      email: params.email,
      metadata: { user_id: params.userId },
    });
  }

  // ---- Products / Prices (used by the boot-time sync for recurring SKUs) ----

  async ensureProductAndPrice(params: {
    sku: string;
    name: string;
    unitPrice: number;
    currency: string;
    interval: 'month' | 'year';
  }): Promise<{ productId: string; priceId: string }> {
    // Idempotent by lookup_key on the Price side. Products are created fresh
    // per sync since Stripe doesn't offer a lookup on Product metadata.
    const existing = await this.stripe.prices.list({
      lookup_keys: [`sku:${params.sku}`],
      active: true,
      limit: 1,
    });
    if (existing.data[0]) {
      const price = existing.data[0];
      const productId =
        typeof price.product === 'string' ? price.product : price.product.id;
      return { productId, priceId: price.id };
    }
    const product = await this.stripe.products.create({
      name: params.name,
      metadata: { sku: params.sku },
    });
    const price = await this.stripe.prices.create({
      product: product.id,
      unit_amount: params.unitPrice,
      currency: params.currency.toLowerCase(),
      recurring: { interval: params.interval },
      lookup_key: `sku:${params.sku}`,
    });
    return { productId: product.id, priceId: price.id };
  }

  // ---- Subscriptions ----

  createSubscription(params: {
    customerId: string;
    priceId: string;
    userId: string;
    productSku: string;
    idempotencyKey: string;
  }): Promise<Stripe.Subscription> {
    return this.stripe.subscriptions.create(
      {
        customer: params.customerId,
        items: [{ price: params.priceId }],
        // Return a subscription in "incomplete" state with an initial invoice
        // that has a PaymentIntent attached. Client confirms that PI to
        // activate the subscription — same pattern as one-time payments,
        // same Stripe.js Payment Element on the frontend.
        payment_behavior: 'default_incomplete',
        payment_settings: {
          save_default_payment_method: 'on_subscription',
          payment_method_types: ['card'],
        },
        expand: ['latest_invoice.payment_intent'],
        metadata: { user_id: params.userId, product_sku: params.productSku },
      },
      { idempotencyKey: params.idempotencyKey },
    );
  }

  retrieveSubscription(id: string): Promise<Stripe.Subscription> {
    return this.stripe.subscriptions.retrieve(id, {
      expand: ['latest_invoice.payment_intent'],
    });
  }

  cancelSubscription(
    id: string,
    opts: { immediately?: boolean } = {},
  ): Promise<Stripe.Subscription> {
    // Two ways to cancel a subscription:
    //   - `subscriptions.cancel(id)` ends it immediately (this call)
    //   - `subscriptions.update(id, { cancel_at_period_end: true })` lets the
    //     user finish the period they've paid for
    // Default to the "graceful" pattern because it's the customer-friendly
    // choice and matches how most consumer subscriptions actually behave.
    if (opts.immediately) return this.stripe.subscriptions.cancel(id);
    return this.stripe.subscriptions.update(id, { cancel_at_period_end: true });
  }

  constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
    return this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
  }
}

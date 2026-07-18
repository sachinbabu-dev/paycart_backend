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

  constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
    return this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
  }
}

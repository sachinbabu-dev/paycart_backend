export const SUBSCRIPTION_EVENT_TYPES = {
  Created: 'subscription.created',
  Activated: 'subscription.activated',
  PaymentFailed: 'subscription.payment_failed',
  Canceled: 'subscription.canceled',
  Updated: 'subscription.updated',
} as const;

export interface SubscriptionActivatedPayload {
  subscriptionId: string;
  userId: string;
  productId: string;
  stripeSubscriptionId: string;
}

export interface SubscriptionPaymentFailedPayload {
  subscriptionId: string;
  userId: string;
  productId: string;
  reason: string;
}

export interface SubscriptionCanceledPayload {
  subscriptionId: string;
  userId: string;
  productId: string;
  canceledAt: string;
}

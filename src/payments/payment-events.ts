export const PAYMENT_EVENT_TYPES = {
  Succeeded: 'payment.succeeded',
  Failed: 'payment.failed',
} as const;

export interface PaymentSucceededPayload {
  paymentId: string;
  orderId: string;
  amount: string;
  currency: string;
  stripePaymentIntentId: string;
  items: Array<{ productId: string; quantity: number }>;
}

export interface PaymentFailedPayload {
  paymentId: string;
  orderId: string;
  reason: string;
  stripePaymentIntentId: string;
}

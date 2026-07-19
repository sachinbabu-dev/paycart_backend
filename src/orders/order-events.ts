export const ORDER_EVENT_TYPES = {
  Created: 'order.created',
  PaymentPending: 'order.payment_pending',
  Paid: 'order.paid',
  Failed: 'order.failed',
  Cancelled: 'order.cancelled',
  Preparing: 'order.preparing',
  Shipped: 'order.shipped',
} as const;

export interface OrderPaidPayload {
  orderId: string;
  userId: string;
  totalAmount: string;
  currency: string;
  paymentId: string;
  items: Array<{ productId: string; quantity: number }>;
}

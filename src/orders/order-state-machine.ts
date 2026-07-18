import { BadRequestException } from '@nestjs/common';
import { OrderStatus } from './order-status';

// Explicit allowed-transitions map. Anything not listed here is illegal and
// throws — this is the "state machine" pattern the handoff calls for, kept
// deliberately small rather than pulling in xstate.
const TRANSITIONS: Readonly<Record<OrderStatus, ReadonlyArray<OrderStatus>>> = {
  [OrderStatus.Pending]: [OrderStatus.PaymentPending, OrderStatus.Cancelled],
  [OrderStatus.PaymentPending]: [
    OrderStatus.Paid,
    OrderStatus.Failed,
    OrderStatus.Cancelled,
  ],
  [OrderStatus.Paid]: [OrderStatus.Preparing, OrderStatus.Cancelled],
  [OrderStatus.Preparing]: [OrderStatus.Shipped, OrderStatus.Cancelled],
  [OrderStatus.Shipped]: [],
  [OrderStatus.Cancelled]: [],
  [OrderStatus.Failed]: [OrderStatus.PaymentPending],
};

export class OrderStateMachine {
  static canTransition(from: OrderStatus, to: OrderStatus): boolean {
    return TRANSITIONS[from].includes(to);
  }

  static assertTransition(from: OrderStatus, to: OrderStatus): void {
    if (!this.canTransition(from, to)) {
      throw new BadRequestException(
        `illegal order transition: ${from} -> ${to}`,
      );
    }
  }
}

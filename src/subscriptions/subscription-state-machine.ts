import { BadRequestException } from '@nestjs/common';
import { SubscriptionStatus } from './subscription-status';

// Allowed transitions modelled on Stripe's subscription lifecycle. We accept
// same-state "transitions" as no-ops so the webhook handler can idempotently
// re-apply an event without special-casing.
const TRANSITIONS: Readonly<
  Record<SubscriptionStatus, ReadonlyArray<SubscriptionStatus>>
> = {
  [SubscriptionStatus.Incomplete]: [
    SubscriptionStatus.Active,
    SubscriptionStatus.Trialing,
    SubscriptionStatus.IncompleteExpired,
    SubscriptionStatus.Canceled,
  ],
  [SubscriptionStatus.IncompleteExpired]: [],
  [SubscriptionStatus.Trialing]: [
    SubscriptionStatus.Active,
    SubscriptionStatus.PastDue,
    SubscriptionStatus.Canceled,
    SubscriptionStatus.Paused,
  ],
  [SubscriptionStatus.Active]: [
    SubscriptionStatus.PastDue,
    SubscriptionStatus.Canceled,
    SubscriptionStatus.Paused,
    SubscriptionStatus.Unpaid,
  ],
  [SubscriptionStatus.PastDue]: [
    SubscriptionStatus.Active,
    SubscriptionStatus.Canceled,
    SubscriptionStatus.Unpaid,
  ],
  [SubscriptionStatus.Unpaid]: [
    SubscriptionStatus.Active,
    SubscriptionStatus.Canceled,
  ],
  [SubscriptionStatus.Paused]: [
    SubscriptionStatus.Active,
    SubscriptionStatus.Canceled,
  ],
  [SubscriptionStatus.Canceled]: [],
};

export class SubscriptionStateMachine {
  static canTransition(from: SubscriptionStatus, to: SubscriptionStatus): boolean {
    if (from === to) return true;
    return TRANSITIONS[from].includes(to);
  }

  static assertTransition(from: SubscriptionStatus, to: SubscriptionStatus): void {
    if (!this.canTransition(from, to)) {
      throw new BadRequestException(
        `illegal subscription transition: ${from} -> ${to}`,
      );
    }
  }
}

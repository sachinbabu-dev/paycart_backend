// Mirrors Stripe's subscription status vocabulary so our column values line
// up with what the webhook payloads carry — one less translation layer.
export enum SubscriptionStatus {
  Incomplete = 'incomplete',
  IncompleteExpired = 'incomplete_expired',
  Active = 'active',
  PastDue = 'past_due',
  Canceled = 'canceled',
  Unpaid = 'unpaid',
  Trialing = 'trialing',
  Paused = 'paused',
}

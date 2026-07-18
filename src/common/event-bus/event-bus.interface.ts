export const EVENT_BUS = Symbol('EVENT_BUS');

export interface DomainEvent<T = unknown> {
  type: string;
  aggregateId: string;
  payload: T;
  occurredAt: Date;
}

export type EventHandler<T = unknown> = (event: DomainEvent<T>) => void | Promise<void>;

// Narrow interface so it stays swappable between in-process (EventEmitter2)
// and cross-process (Redis pub/sub) implementations. Handlers must be
// idempotent — both delivery modes may re-deliver on retry.
export interface EventBus {
  publish<T>(event: DomainEvent<T>): Promise<void>;
  subscribe<T>(pattern: string, handler: EventHandler<T>): void;
}

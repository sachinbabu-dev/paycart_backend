import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DomainEvent, EventBus, EventHandler } from './event-bus.interface';

// Default (single-process) implementation. Uses EventEmitter2's wildcard
// support so subscribers can bind to patterns like "payment.*" or "order.*".
@Injectable()
export class InMemoryEventBus implements EventBus {
  private readonly logger = new Logger(InMemoryEventBus.name);

  constructor(private readonly emitter: EventEmitter2) {}

  async publish<T>(event: DomainEvent<T>): Promise<void> {
    this.logger.debug(`publish ${event.type} (${event.aggregateId})`);
    await this.emitter.emitAsync(event.type, event);
  }

  subscribe<T>(pattern: string, handler: EventHandler<T>): void {
    this.emitter.on(pattern, (event: DomainEvent<T>) => {
      void Promise.resolve(handler(event)).catch((err) =>
        this.logger.error(`handler for ${pattern} failed`, err),
      );
    });
  }
}

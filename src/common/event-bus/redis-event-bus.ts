import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { DomainEvent, EventBus, EventHandler } from './event-bus.interface';

// Redis pub/sub implementation. Kept behind the same interface as the
// in-process bus so switching drivers is a one-env-var change. Redis pub/sub
// is fire-and-forget with no persistence — the transactional outbox is what
// makes the overall system at-least-once, not the bus itself.
@Injectable()
export class RedisEventBus implements EventBus, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisEventBus.name);
  private publisher!: Redis;
  private subscriber!: Redis;
  private readonly handlers = new Map<string, EventHandler[]>();

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    // Skip connection setup entirely when this impl isn't the selected driver.
    // The provider is still instantiated (Nest DI needs a concrete instance to
    // wire the EVENT_BUS factory), but we shouldn't open a Redis socket just
    // to sit unused — that's what caused ECONNREFUSED noise on hosts with no
    // Redis service configured.
    if (this.config.get<string>('EVENT_BUS_DRIVER') !== 'redis') return;

    const url = this.config.getOrThrow<string>('REDIS_URL');
    this.publisher = new Redis(url, { lazyConnect: true });
    this.subscriber = new Redis(url, { lazyConnect: true });
    void this.publisher.connect();
    void this.subscriber.connect();

    this.subscriber.on('pmessage', (pattern, channel, message) => {
      const list = this.handlers.get(pattern) ?? [];
      for (const handler of list) {
        try {
          const parsed = JSON.parse(message) as DomainEvent;
          void Promise.resolve(handler(parsed)).catch((err) =>
            this.logger.error(`handler for ${channel} failed`, err),
          );
        } catch (err) {
          this.logger.error(`invalid event payload on ${channel}`, err as Error);
        }
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.publisher?.quit();
    await this.subscriber?.quit();
  }

  async publish<T>(event: DomainEvent<T>): Promise<void> {
    await this.publisher.publish(event.type, JSON.stringify(event));
  }

  subscribe<T>(pattern: string, handler: EventHandler<T>): void {
    // Redis uses glob-style patterns (`*`). Callers pass `payment.*`;
    // no translation needed.
    const list = this.handlers.get(pattern) ?? [];
    list.push(handler as EventHandler);
    this.handlers.set(pattern, list);
    void this.subscriber.psubscribe(pattern);
  }
}

import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EVENT_BUS } from './event-bus.interface';
import { InMemoryEventBus } from './in-memory-event-bus';
import { RedisEventBus } from './redis-event-bus';

// EVENT_BUS_DRIVER env var picks the impl. Interview narrative: default is
// in-process for local dev / portfolio demo; Redis impl exists to prove the
// same code path works when `payments` splits into its own service later.
//
// Both concrete providers are registered so Nest still runs their lifecycle
// hooks (e.g. RedisEventBus.onModuleInit for connection setup); the EVENT_BUS
// token just routes to whichever the env selects.
@Global()
@Module({
  providers: [
    InMemoryEventBus,
    RedisEventBus,
    {
      provide: EVENT_BUS,
      inject: [ConfigService, InMemoryEventBus, RedisEventBus],
      useFactory: (
        config: ConfigService,
        inMemory: InMemoryEventBus,
        redis: RedisEventBus,
      ) => {
        const driver = config.get<string>('EVENT_BUS_DRIVER', 'memory');
        return driver === 'redis' ? redis : inMemory;
      },
    },
  ],
  exports: [EVENT_BUS],
})
export class EventBusModule {}

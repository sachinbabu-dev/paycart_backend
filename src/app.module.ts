import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './common/database/database.module';
import { EventBusModule } from './common/event-bus/event-bus.module';
import { OutboxModule } from './common/outbox/outbox.module';
import { envValidationSchema } from './config/env.validation';
import { FulfillmentModule } from './fulfillment/fulfillment.module';
import { InventoryModule } from './inventory/inventory.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { ProductsModule } from './products/products.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { WellKnownModule } from './well-known/well-known.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
    }),
    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    EventBusModule,
    OutboxModule,
    AuthModule,
    ProductsModule,
    OrdersModule,
    SubscriptionsModule,
    PaymentsModule,
    InventoryModule,
    NotificationsModule,
    FulfillmentModule,
    WellKnownModule,
  ],
})
export class AppModule {}

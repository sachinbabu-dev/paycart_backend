import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { PaymentEntity } from './entities/payment.entity';
import { WebhookEventEntity } from './entities/webhook-event.entity';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { StripeService } from './stripe.service';
import { StripeWebhookController } from './stripe-webhook.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([PaymentEntity, WebhookEventEntity]),
    AuthModule,
    OrdersModule,
    forwardRef(() => SubscriptionsModule),
  ],
  controllers: [PaymentsController, StripeWebhookController],
  providers: [PaymentsService, StripeService],
  // StripeService is exported so SubscriptionsService can use it directly,
  // keeping the Stripe SDK dep inside this module only.
  exports: [StripeService],
})
export class PaymentsModule {}

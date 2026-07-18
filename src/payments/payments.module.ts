import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
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
  ],
  controllers: [PaymentsController, StripeWebhookController],
  providers: [PaymentsService, StripeService],
})
export class PaymentsModule {}

import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { UserEntity } from '../auth/user.entity';
import { PaymentsModule } from '../payments/payments.module';
import { ProductsModule } from '../products/products.module';
import { ProductEntity } from '../products/product.entity';
import { SubscriptionEventEntity } from './entities/subscription-event.entity';
import { SubscriptionEntity } from './entities/subscription.entity';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

// forwardRef on PaymentsModule because PaymentsService (webhook handler)
// depends on SubscriptionsService for the subscription-related event types,
// and SubscriptionsService depends on StripeService which lives in
// PaymentsModule. The circular dep is real and forwardRef is the standard
// Nest resolution.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      SubscriptionEntity,
      SubscriptionEventEntity,
      UserEntity,
      ProductEntity,
    ]),
    AuthModule,
    ProductsModule,
    forwardRef(() => PaymentsModule),
  ],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}

import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { FulfillmentService } from './fulfillment.service';

// OutboxModule and EventBusModule are @Global(), so their services are
// available without explicit imports here. OrdersModule is imported for its
// exported OrdersService.
@Module({
  imports: [OrdersModule],
  providers: [FulfillmentService],
})
export class FulfillmentModule {}

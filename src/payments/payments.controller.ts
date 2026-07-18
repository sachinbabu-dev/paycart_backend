import {
  Controller,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { CheckoutResult, PaymentsService } from './payments.service';

@ApiTags('payments')
@ApiBearerAuth('access-token')
@Controller('orders')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  // Route lives under /orders/:id/checkout because the payment is a lifecycle
  // event of the order aggregate. Client MUST send an Idempotency-Key header
  // — retrying without one would risk double-charging on network flakiness.
  @Post(':id/checkout')
  @ApiOperation({
    summary: 'Create a Stripe PaymentIntent for an order.',
    description:
      'Requires an `Idempotency-Key` header. Replaying the same key returns the same PaymentIntent instead of creating a new one — safe under client retry.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Client-generated unique key per checkout attempt.',
    example: '4f3c9b2a-0d18-4d1e-9f5b-2c8a9b0f7e11',
  })
  checkout(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) orderId: string,
    @Headers('idempotency-key') idempotencyKey: string,
  ): Promise<CheckoutResult> {
    return this.payments.checkout({
      orderId,
      userId: user.id,
      idempotencyKey,
    });
  }
}

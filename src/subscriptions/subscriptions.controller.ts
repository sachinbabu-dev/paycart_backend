import {
  Body,
  Controller,
  Get,
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
import { SubscribeDto } from './dto/subscribe.dto';
import { SubscriptionEntity } from './entities/subscription.entity';
import { SubscribeResult, SubscriptionsService } from './subscriptions.service';

@ApiTags('subscriptions')
@ApiBearerAuth('access-token')
@Controller('subscriptions')
@UseGuards(JwtAuthGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Post()
  @ApiOperation({
    summary: 'Start a subscription. Returns a client_secret to confirm.',
    description:
      'Creates the subscription in Stripe with `payment_behavior=default_incomplete`. The returned `clientSecret` is the incomplete invoice\'s PaymentIntent — the client confirms it via Stripe.js (Payment Element or Payment Request Button, the latter is what surfaces Apple Pay on Safari).',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Client-generated unique key per subscribe attempt.',
    example: '4f3c9b2a-0d18-4d1e-9f5b-2c8a9b0f7e11',
  })
  subscribe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubscribeDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ): Promise<SubscribeResult> {
    return this.subscriptions.subscribe({
      userId: user.id,
      userEmail: user.email,
      productSku: dto.productSku,
      idempotencyKey,
    });
  }

  @Get()
  @ApiOperation({ summary: "List the caller's subscriptions." })
  list(@CurrentUser() user: AuthenticatedUser): Promise<SubscriptionEntity[]> {
    return this.subscriptions.listForUser(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one subscription (owner only).' })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SubscriptionEntity> {
    return this.subscriptions.findByIdForUser(id, user.id);
  }

  @Post(':id/cancel')
  @ApiOperation({
    summary: 'Cancel a subscription at period end (default) or immediately.',
    description:
      'Default: sets `cancel_at_period_end=true` so the user finishes the period they paid for. Pass `?immediately=true` to end right now. Stripe pushes a webhook that updates local status either way.',
  })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SubscriptionEntity> {
    return this.subscriptions.cancel(id, user.id);
  }
}

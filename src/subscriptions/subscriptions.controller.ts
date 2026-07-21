import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Sse,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Observable } from 'rxjs';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtStreamAuthGuard } from '../auth/jwt-stream-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { SubscribeDto } from './dto/subscribe.dto';
import { SubscriptionEntity } from './entities/subscription.entity';
import { SubscriptionStreamService } from './subscription-stream.service';
import { SubscribeResult, SubscriptionsService } from './subscriptions.service';

// Guards are declared per-method rather than at the class level: the SSE
// endpoint needs its own guard because EventSource cannot set an Authorization
// header — it accepts a stream-scoped token via ?token=. Same pattern as
// OrdersController.
@ApiTags('subscriptions')
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(
    private readonly subscriptions: SubscriptionsService,
    private readonly stream: SubscriptionStreamService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
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
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: "List the caller's subscriptions." })
  list(@CurrentUser() user: AuthenticatedUser): Promise<SubscriptionEntity[]> {
    return this.subscriptions.listForUser(user.id);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get one subscription (owner only).' })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SubscriptionEntity> {
    return this.subscriptions.findByIdForUser(id, user.id);
  }

  @Post(':id/cancel')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
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

  @Post(':id/sync')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Pull the latest subscription state from Stripe and apply it.',
    description:
      'Reconciliation path for missed / delayed / out-of-order webhooks. Fetches the current subscription from Stripe, applies the same state-machine and outbox logic as the `customer.subscription.updated` webhook, and returns the resulting local row. Idempotent — safe to spam. SSE clients receive a `subscription.updated` event as usual.',
  })
  sync(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SubscriptionEntity> {
    return this.subscriptions.syncFromStripe(id, user.id);
  }

  @Sse(':id/stream')
  @UseGuards(JwtStreamAuthGuard)
  @ApiOperation({
    summary: 'Live server-sent event stream of subscription updates.',
    description:
      'Opens an SSE connection. First message is a snapshot (current subscription + full event history). Subsequent messages are pushed as `subscription.*` events fire (created, activated, updated, payment_failed, canceled). Auth via short-lived stream token from POST /auth/stream-token, passed as ?token=. Keepalive pings prevent proxy idle timeouts.',
  })
  @ApiQuery({
    name: 'token',
    required: true,
    description: 'Short-lived stream-scoped JWT from POST /auth/stream-token.',
  })
  streamOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Observable<{ data: unknown }> {
    return this.stream.forSubscription(id, user.id);
  }
}

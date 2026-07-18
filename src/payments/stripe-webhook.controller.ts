import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { PaymentsService } from './payments.service';
import { StripeService } from './stripe.service';

// Public endpoint (no auth guard) — the caller is Stripe, authenticated by
// signature. Body is verified against STRIPE_WEBHOOK_SECRET using the raw
// bytes preserved in main.ts; any tampering breaks the HMAC.
//
// Return 200 as soon as the event is durably recorded. Slow processing here
// is an antipattern: Stripe retries on non-2xx and on timeouts (>30s), so any
// heavy fan-out happens off the request path via the outbox.
//
// Hidden from the public API docs — this endpoint is called by Stripe, not
// by end users, and can't be exercised meaningfully from a "try it out" UI.
@ApiExcludeController()
@Controller('webhooks/stripe')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(
    private readonly stripe: StripeService,
    private readonly payments: PaymentsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async handle(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('stripe-signature') signature: string,
  ): Promise<{ received: true }> {
    if (!signature) throw new BadRequestException('missing stripe-signature');
    if (!req.rawBody) throw new BadRequestException('raw body unavailable');

    let event;
    try {
      event = this.stripe.constructWebhookEvent(req.rawBody, signature);
    } catch (err) {
      this.logger.warn(`webhook signature verification failed: ${(err as Error).message}`);
      throw new BadRequestException('invalid signature');
    }

    await this.payments.handleWebhookEvent(event);
    return { received: true };
  }
}

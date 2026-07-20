import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';

// Serves the Apple Pay domain-verification file. Stripe requires this file
// to be reachable at exactly this path to enable Apple Pay on your domain.
//
// Workflow:
//   1. Stripe dashboard → Settings → Payment methods → Apple Pay → Configure
//      → Add a new domain → downloads a plain-text token.
//   2. Put the file contents (single line) into APPLE_PAY_DOMAIN_ASSOCIATION.
//   3. Stripe polls this URL and, if the contents match, marks the domain
//      verified. The Payment Element then shows Apple Pay on eligible clients.
//
// The endpoint is intentionally hidden from Scalar — nothing to try there.
@ApiExcludeController()
@Controller('.well-known')
export class ApplePayController {
  constructor(private readonly config: ConfigService) {}

  @Get('apple-developer-merchantid-domain-association')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/plain')
  serve(): string {
    const contents = this.config.get<string>('APPLE_PAY_DOMAIN_ASSOCIATION');
    if (!contents) {
      throw new NotFoundException(
        'Apple Pay domain association not configured on this deployment',
      );
    }
    return contents;
  }
}

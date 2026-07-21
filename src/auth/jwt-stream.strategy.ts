import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthenticatedUser } from './jwt.strategy';
import { UserRole } from './user-role';

export const STREAM_TOKEN_SCOPE = 'stream';

interface StreamJwtPayload {
  sub: string;
  email?: string;
  scope: string;
}

// Separate Passport strategy for the SSE endpoint. Browsers can't set custom
// headers on EventSource, so the token has to travel in the URL — which means
// it lands in access logs, browser history, referer headers, etc. To limit
// the blast radius:
//
//   1. Only tokens with an explicit `scope: 'stream'` claim are accepted here.
//   2. Those tokens are issued by /auth/stream-token with a 60-second TTL.
//
// A leak of the URL-borne token is a leak of a 60-second, read-only stream
// credential — not the 7-day full-access bearer.
@Injectable()
export class JwtStreamStrategy extends PassportStrategy(Strategy, 'jwt-stream') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) => {
          const raw = req.query?.token;
          return typeof raw === 'string' ? raw : null;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  validate(payload: StreamJwtPayload): AuthenticatedUser {
    if (payload.scope !== STREAM_TOKEN_SCOPE) {
      throw new UnauthorizedException('token is not scoped for streaming');
    }
    // Stream tokens are read-only and only used by the SSE order stream —
    // role authorization is not applied there, so default to Customer.
    return {
      id: payload.sub,
      email: payload.email ?? '',
      role: UserRole.Customer,
    };
  }
}

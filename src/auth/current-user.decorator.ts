import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { AuthenticatedUser } from './jwt.strategy';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const req = ctx.switchToHttp().getRequest<{ user: AuthenticatedUser }>();
    return req.user;
  },
);

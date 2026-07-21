import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedUser } from './jwt.strategy';
import { ROLES_METADATA_KEY } from './roles.decorator';
import { UserRole } from './user-role';

// Meant to run AFTER JwtAuthGuard — reads req.user set by passport-jwt.
// No metadata => guard is a no-op, so it composes safely on class-level.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const req = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    const user = req.user;
    if (!user) throw new ForbiddenException('authentication required');
    if (!required.includes(user.role)) {
      throw new ForbiddenException('insufficient role');
    }
    return true;
  }
}

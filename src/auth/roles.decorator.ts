import { SetMetadata } from '@nestjs/common';
import { UserRole } from './user-role';

export const ROLES_METADATA_KEY = 'roles';

export const Roles = (...roles: UserRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_METADATA_KEY, roles);

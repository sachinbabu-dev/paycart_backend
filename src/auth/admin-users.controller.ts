import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminUsersService, type AdminUserView } from './admin-users.service';
import { CurrentUser } from './current-user.decorator';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { AuthenticatedUser } from './jwt.strategy';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';
import { UserRole } from './user-role';

@ApiTags('admin')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SuperAdmin)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly adminUsers: AdminUsersService) {}

  @Get()
  @ApiOperation({ summary: 'List every user with their role. Superadmin only.' })
  list(): Promise<AdminUserView[]> {
    return this.adminUsers.list();
  }

  @Post()
  @ApiOperation({
    summary: 'Create a new admin or superadmin account. Superadmin only.',
  })
  create(@Body() dto: CreateAdminUserDto): Promise<AdminUserView> {
    return this.adminUsers.createAdmin(
      dto.email,
      dto.password,
      dto.role ?? UserRole.Admin,
    );
  }

  @Patch(':id/role')
  @ApiOperation({
    summary: 'Promote or demote a user. Cannot demote self or last superadmin.',
  })
  updateRole(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateUserRoleDto,
  ): Promise<AdminUserView> {
    return this.adminUsers.updateRole(actor.id, id, dto.role);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Soft-delete a user (customer or admin). Cannot delete self or last superadmin.',
    description:
      'Sets deleted_at. The row is retained so historical orders/payments still resolve; the email becomes reusable for a fresh signup.',
  })
  async remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.adminUsers.softDelete(actor.id, id);
  }
}

import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { UserRole } from '../user-role';

export class CreateAdminUserDto {
  @ApiProperty({ example: 'ops@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'correct-horse-battery-staple', minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({
    enum: [UserRole.Admin, UserRole.SuperAdmin],
    default: UserRole.Admin,
    required: false,
    description: 'Role to grant. Customers are created via /auth/signup.',
  })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole.Admin | UserRole.SuperAdmin;
}

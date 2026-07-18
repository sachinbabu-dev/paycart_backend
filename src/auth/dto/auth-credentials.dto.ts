import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class AuthCredentialsDto {
  @ApiProperty({ example: 'buyer@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'correct-horse-battery-staple', minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;
}

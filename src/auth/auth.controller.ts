import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService, AuthResult } from './auth.service';
import { AuthCredentialsDto } from './dto/auth-credentials.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('signup')
  @ApiOperation({ summary: 'Create a new user and return a JWT.' })
  signup(@Body() dto: AuthCredentialsDto): Promise<AuthResult> {
    return this.auth.signup(dto.email, dto.password);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange email + password for a JWT.' })
  login(@Body() dto: AuthCredentialsDto): Promise<AuthResult> {
    return this.auth.login(dto.email, dto.password);
  }
}

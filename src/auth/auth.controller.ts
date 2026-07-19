import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService, AuthResult, StreamTokenResult } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { AuthCredentialsDto } from './dto/auth-credentials.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { AuthenticatedUser } from './jwt.strategy';

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

  @Post('stream-token')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Mint a short-lived (60s) token for the SSE order stream.',
    description:
      'EventSource cannot set custom headers, so the SSE endpoint accepts its token via a query string. That token is scoped to streaming only and expires quickly, limiting the blast radius of URL/log leakage.',
  })
  streamToken(@CurrentUser() user: AuthenticatedUser): StreamTokenResult {
    return this.auth.issueStreamToken(user.id, user.email);
  }
}

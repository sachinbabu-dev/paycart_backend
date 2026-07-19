import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtStreamAuthGuard extends AuthGuard('jwt-stream') {}

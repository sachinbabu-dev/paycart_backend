import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { UserEntity } from './user.entity';
import { UserRole } from './user-role';

const BCRYPT_COST = 12;
const STREAM_TOKEN_TTL = '60s';

export interface AuthResult {
  accessToken: string;
  user: { id: string; email: string; role: UserRole };
}

export interface StreamTokenResult {
  streamToken: string;
  expiresIn: number;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    private readonly jwt: JwtService,
  ) {}

  // Public signup path — always creates a customer. Admin/superadmin accounts
  // are created only via the admin endpoints (see AdminUsersController).
  async signup(email: string, password: string): Promise<AuthResult> {
    const existing = await this.users.findOne({ where: { email } });
    if (existing) throw new ConflictException('email already registered');

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const user = await this.users.save(
      this.users.create({ email, passwordHash, role: UserRole.Customer }),
    );
    return this.issueToken(user);
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const user = await this.users.findOne({ where: { email } });
    if (!user) throw new UnauthorizedException('invalid credentials');
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('invalid credentials');
    return this.issueToken(user);
  }

  // Mints a short-lived JWT specifically scoped for the SSE endpoint. Caller
  // must already hold a valid main bearer (enforced by the controller guard).
  // Kept deliberately short — this token travels in the URL query string.
  issueStreamToken(userId: string, email: string): StreamTokenResult {
    const streamToken = this.jwt.sign(
      { sub: userId, email, scope: 'stream' },
      { expiresIn: STREAM_TOKEN_TTL },
    );
    return { streamToken, expiresIn: 60 };
  }

  private issueToken(user: UserEntity): AuthResult {
    const accessToken = this.jwt.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
    });
    return {
      accessToken,
      user: { id: user.id, email: user.email, role: user.role },
    };
  }
}

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

const BCRYPT_COST = 12;

export interface AuthResult {
  accessToken: string;
  user: { id: string; email: string };
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    private readonly jwt: JwtService,
  ) {}

  async signup(email: string, password: string): Promise<AuthResult> {
    const existing = await this.users.findOne({ where: { email } });
    if (existing) throw new ConflictException('email already registered');

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const user = await this.users.save(this.users.create({ email, passwordHash }));
    return this.issueToken(user);
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const user = await this.users.findOne({ where: { email } });
    if (!user) throw new UnauthorizedException('invalid credentials');
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('invalid credentials');
    return this.issueToken(user);
  }

  private issueToken(user: UserEntity): AuthResult {
    const accessToken = this.jwt.sign({ sub: user.id, email: user.email });
    return { accessToken, user: { id: user.id, email: user.email } };
  }
}

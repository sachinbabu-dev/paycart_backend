import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { UserEntity } from './user.entity';
import { UserRole } from './user-role';

const BCRYPT_COST = 12;

export interface AdminUserView {
  id: string;
  email: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    private readonly config: ConfigService,
  ) {}

  // Seeds one superadmin on boot from SUPERADMIN_EMAIL/SUPERADMIN_PASSWORD.
  // No-op if the env vars are unset or if any superadmin already exists —
  // this is the escape hatch for the first deploy, not an ongoing sync.
  async bootstrapSuperAdmin(): Promise<void> {
    const email = this.config.get<string>('SUPERADMIN_EMAIL');
    const password = this.config.get<string>('SUPERADMIN_PASSWORD');
    if (!email || !password) return;

    const existing = await this.users.findOne({
      where: { role: UserRole.SuperAdmin },
    });
    if (existing) return;

    const byEmail = await this.users.findOne({ where: { email } });
    if (byEmail) {
      byEmail.role = UserRole.SuperAdmin;
      await this.users.save(byEmail);
      this.logger.log(`promoted existing user ${email} to superadmin`);
      return;
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    await this.users.save(
      this.users.create({ email, passwordHash, role: UserRole.SuperAdmin }),
    );
    this.logger.log(`seeded superadmin ${email}`);
  }

  async list(): Promise<AdminUserView[]> {
    const rows = await this.users.find({ order: { createdAt: 'ASC' } });
    return rows.map(this.toView);
  }

  async createAdmin(
    email: string,
    password: string,
    role: UserRole.Admin | UserRole.SuperAdmin,
  ): Promise<AdminUserView> {
    const existing = await this.users.findOne({ where: { email } });
    if (existing) throw new ConflictException('email already registered');

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const user = await this.users.save(
      this.users.create({ email, passwordHash, role }),
    );
    return this.toView(user);
  }

  async updateRole(
    actorId: string,
    targetId: string,
    role: UserRole,
  ): Promise<AdminUserView> {
    const target = await this.users.findOne({ where: { id: targetId } });
    if (!target) throw new NotFoundException('user not found');

    if (target.role === role) return this.toView(target);

    // Guardrails so the deployment can't lock itself out: superadmins can't
    // demote themselves, and the last superadmin can't be demoted at all.
    if (target.role === UserRole.SuperAdmin && role !== UserRole.SuperAdmin) {
      if (actorId === target.id) {
        throw new BadRequestException('superadmin cannot demote themselves');
      }
      const superadminCount = await this.users.count({
        where: { role: UserRole.SuperAdmin },
      });
      if (superadminCount <= 1) {
        throw new BadRequestException('cannot demote the last superadmin');
      }
    }

    target.role = role;
    const saved = await this.users.save(target);
    return this.toView(saved);
  }

  private toView(user: UserEntity): AdminUserView {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}

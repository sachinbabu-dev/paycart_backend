import { Logger, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStreamStrategy } from './jwt-stream.strategy';
import { JwtStrategy } from './jwt.strategy';
import { RolesGuard } from './roles.guard';
import { UserEntity } from './user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity]),
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: config.get<string>('JWT_EXPIRES_IN', '7d'),
        },
      }),
    }),
  ],
  controllers: [AuthController, AdminUsersController],
  providers: [
    AuthService,
    AdminUsersService,
    JwtStrategy,
    JwtStreamStrategy,
    RolesGuard,
  ],
  exports: [JwtStrategy, JwtStreamStrategy, PassportModule, RolesGuard],
})
export class AuthModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuthModule.name);

  constructor(private readonly adminUsers: AdminUsersService) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.adminUsers.bootstrapSuperAdmin();
    } catch (err) {
      // Don't crash the app if bootstrap fails — log loudly and continue.
      // Common cause on first boot is that migrations haven't run yet.
      this.logger.error('superadmin bootstrap failed', err as Error);
    }
  }
}

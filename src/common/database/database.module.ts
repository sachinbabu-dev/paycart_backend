import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.getOrThrow<string>('DATABASE_URL'),
        autoLoadEntities: true,
        // Migrations are the source of truth. synchronize=true would silently drift
        // and hide bugs — never enabled outside toy code.
        synchronize: false,
        migrationsRun: true,
        migrations: [__dirname + '/migrations/*.{ts,js}'],
        logging: config.get<string>('NODE_ENV') === 'development' ? ['error', 'warn', 'migration'] : ['error'],
      }),
    }),
  ],
})
export class DatabaseModule {}

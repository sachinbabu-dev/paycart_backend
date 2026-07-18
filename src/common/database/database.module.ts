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
        // Railway (and most managed Postgres providers) require SSL. The
        // provider's cert isn't in Node's default trust store, so we accept
        // the presented cert without full chain verification — standard for
        // managed-DB clients that can't be given a custom CA bundle.
        ssl:
          config.get<string>('NODE_ENV') === 'production'
            ? { rejectUnauthorized: false }
            : false,
        logging: config.get<string>('NODE_ENV') === 'development' ? ['error', 'warn', 'migration'] : ['error'],
      }),
    }),
  ],
})
export class DatabaseModule {}

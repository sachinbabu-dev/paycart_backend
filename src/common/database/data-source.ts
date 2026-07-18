import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';

loadEnv();

// Standalone TypeORM DataSource used by the CLI for migration generate/run/revert.
// The runtime DataSource lives in database.module.ts and is built from ConfigService.
export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [__dirname + '/../../**/*.entity.{ts,js}'],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
});

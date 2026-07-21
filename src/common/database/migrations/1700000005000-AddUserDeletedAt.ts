import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserDeletedAt1700000005000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE auth.users
      ADD COLUMN deleted_at TIMESTAMPTZ
    `);
    // Partial index — only live rows need to be scanned for the common
    // "look up user by email" path, and it doubles as the uniqueness
    // constraint we actually want (soft-deleted emails can be reused).
    await queryRunner.query(`
      DROP INDEX IF EXISTS auth.users_email_key;
      ALTER TABLE auth.users DROP CONSTRAINT IF EXISTS users_email_key;
      CREATE UNIQUE INDEX users_email_active_key
        ON auth.users (email)
        WHERE deleted_at IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS auth.users_email_active_key`);
    await queryRunner.query(
      `ALTER TABLE auth.users ADD CONSTRAINT users_email_key UNIQUE (email)`,
    );
    await queryRunner.query(`ALTER TABLE auth.users DROP COLUMN deleted_at`);
  }
}

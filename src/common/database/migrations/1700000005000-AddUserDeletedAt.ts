import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserDeletedAt1700000005000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE auth.users
      ADD COLUMN deleted_at TIMESTAMPTZ
    `);
    // Drop the full-table UNIQUE constraint (this cascades to the index it
    // owns — trying to drop the index directly fails because the constraint
    // depends on it) and replace it with a partial unique index so that
    // soft-deleted emails can be re-registered.
    await queryRunner.query(
      `ALTER TABLE auth.users DROP CONSTRAINT IF EXISTS users_email_key`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX users_email_active_key
        ON auth.users (email)
        WHERE deleted_at IS NULL
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

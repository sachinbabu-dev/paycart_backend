import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserRole1700000004000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE auth.users
      ADD COLUMN role VARCHAR(16) NOT NULL DEFAULT 'customer'
    `);
    await queryRunner.query(`
      ALTER TABLE auth.users
      ADD CONSTRAINT users_role_check
      CHECK (role IN ('customer', 'admin', 'superadmin'))
    `);
    await queryRunner.query(`CREATE INDEX idx_users_role ON auth.users (role)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS auth.idx_users_role`);
    await queryRunner.query(
      `ALTER TABLE auth.users DROP CONSTRAINT IF EXISTS users_role_check`,
    );
    await queryRunner.query(`ALTER TABLE auth.users DROP COLUMN role`);
  }
}

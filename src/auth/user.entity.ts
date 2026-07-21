import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserRole } from './user-role';

@Entity({ schema: 'auth', name: 'users' })
// Partial unique index: soft-deleted emails can be re-registered.
@Index('users_email_active_key', ['email'], {
  unique: true,
  where: '"deleted_at" IS NULL',
})
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash!: string;

  @Column({ type: 'varchar', length: 16, default: UserRole.Customer })
  role!: UserRole;

  // Lazily populated on the user's first subscription. See
  // SubscriptionsService.ensureStripeCustomer.
  @Column({
    name: 'stripe_customer_id',
    type: 'varchar',
    length: 64,
    nullable: true,
    unique: true,
  })
  stripeCustomerId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  // Soft-delete: set on DELETE /admin/users/:id. Repository queries filter
  // this out by default; explicitly `withDeleted: true` to include them.
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CouponType } from '../coupon-type';

@Entity({ schema: 'coupons', name: 'coupons' })
export class CouponEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // User-facing code (case-insensitive by convention — we uppercase before
  // insert/lookup). Unique across the table so lookup by code is a point-read.
  @Column({ type: 'varchar', length: 64, unique: true })
  code!: string;

  @Column({ type: 'varchar', length: 16 })
  type!: CouponType;

  // For `percentage`: an integer 1..100. For `fixed`: a positive minor-unit
  // amount (matches the units used elsewhere for money).
  @Column({ type: 'int' })
  value!: number;

  // Required for `fixed` (enforced by CHECK constraint) so we can reject a
  // USD coupon being applied to an EUR order. Null for `percentage`, since a
  // percentage discount is currency-agnostic.
  @Column({ type: 'varchar', length: 3, nullable: true })
  currency!: string | null;

  @Column({ name: 'min_order_amount', type: 'bigint', nullable: true })
  minOrderAmount!: string | null;

  @Column({ name: 'max_redemptions', type: 'int', nullable: true })
  maxRedemptions!: number | null;

  // Incremented atomically inside the redemption transaction under a
  // pessimistic write lock on this row — prevents overselling when two
  // orders race against the last available redemption.
  @Index()
  @Column({ name: 'redeemed_count', type: 'int', default: 0 })
  redeemedCount!: number;

  @Column({ name: 'valid_from', type: 'timestamptz', nullable: true })
  validFrom!: Date | null;

  @Column({ name: 'valid_until', type: 'timestamptz', nullable: true })
  validUntil!: Date | null;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

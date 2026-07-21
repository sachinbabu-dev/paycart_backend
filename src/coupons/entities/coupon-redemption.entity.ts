import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CouponEntity } from './coupon.entity';

// Immutable audit row: one per successful coupon application. `order_id` has
// a UNIQUE constraint so an order can never be double-discounted, which also
// makes the whole redemption flow idempotent — retrying a create with the
// same order_id becomes a unique-violation the service can recover from.
@Entity({ schema: 'coupons', name: 'coupon_redemptions' })
export class CouponRedemptionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => CouponEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'coupon_id' })
  coupon!: CouponEntity;

  @Column({ name: 'coupon_id', type: 'uuid' })
  couponId!: string;

  @Index({ unique: true })
  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'discount_amount', type: 'bigint' })
  discountAmount!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

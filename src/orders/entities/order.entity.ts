import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OrderStatus } from '../order-status';
import { OrderItemEntity } from './order-item.entity';

@Entity({ schema: 'orders', name: 'orders' })
export class OrderEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Index()
  @Column({ type: 'varchar', length: 32 })
  status!: OrderStatus;

  // Amounts stored in the smallest currency unit (cents) as bigint to avoid
  // float rounding. Column typed as string in TypeORM because JS numbers
  // can't safely represent all int64 values.
  @Column({ name: 'total_amount', type: 'bigint' })
  totalAmount!: string;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @OneToMany(() => OrderItemEntity, (item) => item.order, {
    cascade: ['insert'],
    eager: true,
  })
  items!: OrderItemEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

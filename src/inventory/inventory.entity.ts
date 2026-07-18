import {
  Column,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ schema: 'inventory', name: 'inventory' })
export class InventoryEntity {
  @PrimaryColumn({ name: 'product_id', type: 'varchar', length: 64 })
  productId!: string;

  @Column({ name: 'stock_quantity', type: 'int' })
  stockQuantity!: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

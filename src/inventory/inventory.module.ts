import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryController } from './inventory.controller';
import { InventoryEntity } from './inventory.entity';
import { InventoryService } from './inventory.service';
import { StockAdjustmentEntity } from './stock-adjustment.entity';

@Module({
  imports: [TypeOrmModule.forFeature([InventoryEntity, StockAdjustmentEntity])],
  controllers: [InventoryController],
  providers: [InventoryService],
})
export class InventoryModule {}

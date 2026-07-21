import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { InventoryController } from './inventory.controller';
import { InventoryEntity } from './inventory.entity';
import { InventoryService } from './inventory.service';
import { StockAdjustmentEntity } from './stock-adjustment.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([InventoryEntity, StockAdjustmentEntity]),
    AuthModule,
  ],
  controllers: [InventoryController],
  providers: [InventoryService],
})
export class InventoryModule {}

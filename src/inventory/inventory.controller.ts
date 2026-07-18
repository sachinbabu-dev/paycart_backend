import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InventoryEntity } from './inventory.entity';
import { InventoryService } from './inventory.service';

@ApiTags('inventory')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  @ApiOperation({ summary: 'List current stock for every known product.' })
  list(): Promise<InventoryEntity[]> {
    return this.inventory.list();
  }

  @Get(':productId')
  @ApiOperation({ summary: 'Get current stock for a single product.' })
  async get(@Param('productId') productId: string): Promise<InventoryEntity> {
    const row = await this.inventory.getStock(productId);
    if (!row) throw new NotFoundException('product not found');
    return row;
  }
}

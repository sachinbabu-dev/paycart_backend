import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../auth/user-role';
import { AdjustStockDto } from './dto/adjust-stock.dto';
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

  @Put(':productId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.Admin, UserRole.SuperAdmin)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Set absolute stock for a product. Admin only.',
    description:
      'Manual restock. Bypasses the payment-driven decrement ledger — use this for corrections or receiving new inventory.',
  })
  set(
    @Param('productId') productId: string,
    @Body() dto: AdjustStockDto,
  ): Promise<InventoryEntity> {
    return this.inventory.setStock(productId, dto.stockQuantity);
  }
}

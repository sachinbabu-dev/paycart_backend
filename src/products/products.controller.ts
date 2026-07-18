import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProductEntity } from './product.entity';
import { ProductsService } from './products.service';

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @ApiOperation({ summary: 'List active products in the catalog.' })
  list(): Promise<ProductEntity[]> {
    return this.products.list();
  }

  @Get(':sku')
  @ApiOperation({ summary: 'Get a single product by SKU.' })
  get(@Param('sku') sku: string): Promise<ProductEntity> {
    return this.products.findBySku(sku);
  }
}

import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../auth/user-role';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
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

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.Admin, UserRole.SuperAdmin)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Create a product. Admin only.' })
  create(@Body() dto: CreateProductDto): Promise<ProductEntity> {
    return this.products.create(dto);
  }

  @Patch(':sku')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.Admin, UserRole.SuperAdmin)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Update a product. Admin only.' })
  update(
    @Param('sku') sku: string,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductEntity> {
    return this.products.update(sku, dto);
  }
}

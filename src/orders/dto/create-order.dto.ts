import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateOrderItemDto {
  @ApiProperty({
    example: 'ethiopia-yirgacheffe-250g',
    description: 'Product SKU. Must exist in products.products and be active.',
  })
  @IsString()
  @Length(1, 64)
  productId!: string;

  @ApiProperty({ example: 2, minimum: 1 })
  @IsInt()
  @Min(1)
  quantity!: number;
}

// Note: no `unitPrice` or `currency` on the client input. Prices are looked
// up server-side from the products table at order-create time — trusting a
// client-supplied price is the classic "$1 iPhone" e-commerce bug. Currency
// is derived from the products (all items must share one).
export class CreateOrderDto {
  @ApiProperty({ type: [CreateOrderItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];

  @ApiProperty({
    required: false,
    example: 'WELCOME10',
    description:
      'Optional coupon code applied at order creation. Discount is computed server-side; the total on the returned order reflects it.',
  })
  @IsOptional()
  @IsString()
  @Length(3, 64)
  couponCode?: string;
}

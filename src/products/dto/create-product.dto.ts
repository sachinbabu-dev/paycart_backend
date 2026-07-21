import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
  ValidateIf,
} from 'class-validator';
import { BillingInterval, ProductType } from '../product-type';

export class CreateProductDto {
  @ApiProperty({ example: 'coffee-beans-1kg' })
  @IsString()
  @Length(1, 64)
  @Matches(/^[a-z0-9][a-z0-9-_]*$/, {
    message: 'sku must be lowercase alphanumeric with dashes/underscores',
  })
  sku!: string;

  @ApiProperty({ example: 'Coffee Beans (1kg)' })
  @IsString()
  @Length(1, 255)
  name!: string;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiProperty({ enum: ProductType })
  @IsEnum(ProductType)
  type!: ProductType;

  @ApiProperty({ example: 1999, description: 'Minor units (e.g. cents).' })
  @IsInt()
  @Min(0)
  unitPrice!: number;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @Length(3, 3)
  currency!: string;

  @ApiProperty({ enum: BillingInterval, required: false, nullable: true })
  @ValidateIf((o: CreateProductDto) => o.type === ProductType.Recurring)
  @IsEnum(BillingInterval)
  billingInterval?: BillingInterval | null;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

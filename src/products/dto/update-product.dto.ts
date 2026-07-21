import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';
import { BillingInterval } from '../product-type';

export class UpdateProductDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  name?: string;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiProperty({ required: false, description: 'Minor units.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  unitPrice?: number;

  @ApiProperty({ enum: BillingInterval, required: false, nullable: true })
  @IsOptional()
  @IsEnum(BillingInterval)
  billingInterval?: BillingInterval | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

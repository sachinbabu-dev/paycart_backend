import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  Min,
} from 'class-validator';

// Deliberately narrow: `code`, `type`, and `value` are immutable once issued.
// Rotating a live coupon's discount would silently change the effective price
// for anyone about to redeem it; instead, deactivate and issue a new one.
export class UpdateCouponDto {
  @ApiProperty({ required: false, description: 'Minor units.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  minOrderAmount?: number | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxRedemptions?: number | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  validFrom?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  validUntil?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

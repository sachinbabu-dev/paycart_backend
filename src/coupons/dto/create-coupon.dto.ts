import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { CouponType } from '../coupon-type';

export class CreateCouponDto {
  @ApiProperty({ example: 'WELCOME10' })
  @IsString()
  @Length(3, 64)
  @Matches(/^[A-Z0-9][A-Z0-9-_]*$/, {
    message: 'code must be uppercase alphanumeric with dashes/underscores',
  })
  code!: string;

  @ApiProperty({ enum: CouponType })
  @IsEnum(CouponType)
  type!: CouponType;

  @ApiProperty({
    example: 10,
    description:
      'For percentage: 1..100. For fixed: positive minor units (e.g. cents).',
  })
  @IsInt()
  @Min(1)
  // Upper bound only applies to percentage; the CHECK constraint on the
  // table enforces the real rule. Class-validator applies max on all inputs
  // so we set it high enough for fixed-amount coupons ($1,000,000 in cents).
  @Max(100_000_000)
  value!: number;

  @ApiProperty({
    required: false,
    description: 'ISO 4217. Required when type=fixed.',
  })
  @ValidateIf((o: CreateCouponDto) => o.type === CouponType.Fixed)
  @IsString()
  @Length(3, 3)
  currency?: string;

  @ApiProperty({ required: false, description: 'Minor units.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  minOrderAmount?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxRedemptions?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

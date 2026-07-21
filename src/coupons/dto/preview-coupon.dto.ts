import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Length, Min } from 'class-validator';

export class PreviewCouponDto {
  @ApiProperty({ example: 'WELCOME10' })
  @IsString()
  @Length(3, 64)
  code!: string;

  @ApiProperty({ example: 4999, description: 'Order subtotal in minor units.' })
  @IsInt()
  @Min(1)
  subtotal!: number;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @Length(3, 3)
  currency!: string;
}

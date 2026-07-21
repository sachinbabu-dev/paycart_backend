import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class AdjustStockDto {
  @ApiProperty({
    example: 100,
    description: 'Absolute stock quantity to set. Must be non-negative.',
  })
  @IsInt()
  @Min(0)
  stockQuantity!: number;
}

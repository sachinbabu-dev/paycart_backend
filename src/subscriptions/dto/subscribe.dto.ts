import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class SubscribeDto {
  @ApiProperty({
    example: 'coffee-club-monthly',
    description: 'SKU of a recurring product from products.products.',
  })
  @IsString()
  @Length(1, 64)
  productSku!: string;
}

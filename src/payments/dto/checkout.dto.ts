import { IsUUID } from 'class-validator';

export class CheckoutParamsDto {
  @IsUUID()
  id!: string;
}

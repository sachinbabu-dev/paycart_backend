import { Module } from '@nestjs/common';
import { ApplePayController } from './apple-pay.controller';

@Module({
  controllers: [ApplePayController],
})
export class WellKnownModule {}

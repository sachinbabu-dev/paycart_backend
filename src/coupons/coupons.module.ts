import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { CouponsController } from './coupons.controller';
import { CouponsService } from './coupons.service';
import { CouponRedemptionEntity } from './entities/coupon-redemption.entity';
import { CouponEntity } from './entities/coupon.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([CouponEntity, CouponRedemptionEntity]),
    AuthModule,
  ],
  controllers: [CouponsController],
  providers: [CouponsService],
  exports: [CouponsService],
})
export class CouponsModule {}

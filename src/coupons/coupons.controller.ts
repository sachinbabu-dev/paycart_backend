import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../auth/user-role';
import { CouponsService, type DiscountQuote } from './coupons.service';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { PreviewCouponDto } from './dto/preview-coupon.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';
import { CouponEntity } from './entities/coupon.entity';

// Serialized quote — bigint doesn't survive JSON, and we already store money
// as strings on the wire elsewhere (order.totalAmount) for the same reason.
interface DiscountQuoteResponse {
  couponId: string;
  code: string;
  discountAmount: string;
  subtotal: string;
  total: string;
  currency: string;
}

function serialize(quote: DiscountQuote): DiscountQuoteResponse {
  return {
    couponId: quote.couponId,
    code: quote.code,
    discountAmount: quote.discountAmount.toString(),
    subtotal: quote.subtotal.toString(),
    total: quote.total.toString(),
    currency: quote.currency,
  };
}

@ApiTags('coupons')
@Controller('coupons')
export class CouponsController {
  constructor(private readonly coupons: CouponsService) {}

  // Auth-required but not admin-gated: any signed-in user can price-check a
  // code before placing an order. Preview never mutates state, so leaking
  // "coupon exists / doesn't exist" is the worst it can do.
  @Post('preview')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Dry-run a coupon against a subtotal without consuming it.',
  })
  async preview(@Body() dto: PreviewCouponDto): Promise<DiscountQuoteResponse> {
    const quote = await this.coupons.previewByCode(
      dto.code,
      BigInt(dto.subtotal),
      dto.currency,
    );
    return serialize(quote);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.Admin, UserRole.SuperAdmin)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'List all coupons. Admin only.' })
  list(): Promise<CouponEntity[]> {
    return this.coupons.list();
  }

  @Get(':code')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.Admin, UserRole.SuperAdmin)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get a single coupon by code. Admin only.' })
  get(@Param('code') code: string): Promise<CouponEntity> {
    return this.coupons.findByCode(code);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.Admin, UserRole.SuperAdmin)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Create a coupon. Admin only.' })
  create(@Body() dto: CreateCouponDto): Promise<CouponEntity> {
    return this.coupons.create(dto);
  }

  @Patch(':code')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.Admin, UserRole.SuperAdmin)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Update a coupon. Admin only.',
    description:
      'Only limits and validity window can change — type, value, and code are immutable once issued.',
  })
  update(
    @Param('code') code: string,
    @Body() dto: UpdateCouponDto,
  ): Promise<CouponEntity> {
    return this.coupons.update(code, dto);
  }

  @Delete(':code')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.Admin, UserRole.SuperAdmin)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Deactivate a coupon (soft delete). Admin only.',
    description:
      'Redemption history references the coupon so we never hard-delete; active=false is enough to stop new applications.',
  })
  remove(@Param('code') code: string): Promise<CouponEntity> {
    return this.coupons.deactivate(code);
  }
}

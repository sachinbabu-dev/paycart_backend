import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, QueryFailedError, Repository } from 'typeorm';
import { CouponType } from './coupon-type';
import { CouponRedemptionEntity } from './entities/coupon-redemption.entity';
import { CouponEntity } from './entities/coupon.entity';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';

const UNIQUE_VIOLATION = '23505';

export interface DiscountQuote {
  couponId: string;
  code: string;
  discountAmount: bigint;
  subtotal: bigint;
  total: bigint;
  currency: string;
}

@Injectable()
export class CouponsService {
  constructor(
    @InjectRepository(CouponEntity)
    private readonly coupons: Repository<CouponEntity>,
    @InjectRepository(CouponRedemptionEntity)
    private readonly redemptions: Repository<CouponRedemptionEntity>,
  ) {}

  // ---- Admin CRUD ----

  async create(dto: CreateCouponDto): Promise<CouponEntity> {
    if (dto.type === CouponType.Percentage && dto.value > 100) {
      throw new BadRequestException('percentage value must be between 1 and 100');
    }
    const validFrom = dto.validFrom ? new Date(dto.validFrom) : null;
    const validUntil = dto.validUntil ? new Date(dto.validUntil) : null;
    if (validFrom && validUntil && validFrom >= validUntil) {
      throw new BadRequestException('validFrom must be before validUntil');
    }

    try {
      return await this.coupons.save(
        this.coupons.create({
          code: dto.code.toUpperCase(),
          type: dto.type,
          value: dto.value,
          currency:
            dto.type === CouponType.Fixed
              ? (dto.currency as string).toUpperCase()
              : null,
          minOrderAmount:
            dto.minOrderAmount !== undefined ? String(dto.minOrderAmount) : null,
          maxRedemptions: dto.maxRedemptions ?? null,
          validFrom,
          validUntil,
          active: dto.active ?? true,
        }),
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(`coupon code already exists: ${dto.code}`);
      }
      throw err;
    }
  }

  async update(code: string, dto: UpdateCouponDto): Promise<CouponEntity> {
    const coupon = await this.findByCode(code);
    if (dto.minOrderAmount !== undefined) {
      coupon.minOrderAmount =
        dto.minOrderAmount === null ? null : String(dto.minOrderAmount);
    }
    if (dto.maxRedemptions !== undefined) {
      if (
        dto.maxRedemptions !== null &&
        dto.maxRedemptions < coupon.redeemedCount
      ) {
        throw new BadRequestException(
          `maxRedemptions cannot be lower than already-redeemed count (${coupon.redeemedCount})`,
        );
      }
      coupon.maxRedemptions = dto.maxRedemptions;
    }
    if (dto.validFrom !== undefined) {
      coupon.validFrom = dto.validFrom ? new Date(dto.validFrom) : null;
    }
    if (dto.validUntil !== undefined) {
      coupon.validUntil = dto.validUntil ? new Date(dto.validUntil) : null;
    }
    if (dto.active !== undefined) coupon.active = dto.active;
    if (
      coupon.validFrom &&
      coupon.validUntil &&
      coupon.validFrom >= coupon.validUntil
    ) {
      throw new BadRequestException('validFrom must be before validUntil');
    }
    return this.coupons.save(coupon);
  }

  async deactivate(code: string): Promise<CouponEntity> {
    const coupon = await this.findByCode(code);
    if (!coupon.active) return coupon;
    coupon.active = false;
    return this.coupons.save(coupon);
  }

  list(): Promise<CouponEntity[]> {
    return this.coupons.find({ order: { createdAt: 'DESC' } });
  }

  async findByCode(code: string): Promise<CouponEntity> {
    const coupon = await this.coupons.findOne({
      where: { code: code.toUpperCase() },
    });
    if (!coupon) throw new NotFoundException(`unknown coupon: ${code}`);
    return coupon;
  }

  // ---- Application ----

  // Pure calculator — no DB writes, no locks. Used by the preview endpoint and
  // reused inside redeemInTransaction after the row is locked.
  quote(
    coupon: CouponEntity,
    subtotal: bigint,
    currency: string,
    now: Date = new Date(),
  ): DiscountQuote {
    if (!coupon.active) throw new BadRequestException('coupon is not active');
    if (coupon.validFrom && now < coupon.validFrom) {
      throw new BadRequestException('coupon is not yet valid');
    }
    if (coupon.validUntil && now >= coupon.validUntil) {
      throw new BadRequestException('coupon has expired');
    }
    if (
      coupon.maxRedemptions !== null &&
      coupon.redeemedCount >= coupon.maxRedemptions
    ) {
      throw new ConflictException('coupon has reached its redemption limit');
    }
    if (coupon.minOrderAmount !== null) {
      const min = BigInt(coupon.minOrderAmount);
      if (subtotal < min) {
        throw new BadRequestException(
          `order subtotal must be at least ${min} to use this coupon`,
        );
      }
    }
    if (coupon.type === CouponType.Fixed) {
      if (!coupon.currency || coupon.currency !== currency.toUpperCase()) {
        throw new BadRequestException(
          `coupon currency ${coupon.currency} does not match order currency ${currency}`,
        );
      }
    }

    // Cap fixed discounts at the subtotal so an order never goes negative; a
    // 100% freebie is valid, an overpay-refund via coupon is not.
    let discount: bigint;
    if (coupon.type === CouponType.Percentage) {
      discount = (subtotal * BigInt(coupon.value)) / 100n;
    } else {
      const raw = BigInt(coupon.value);
      discount = raw > subtotal ? subtotal : raw;
    }
    if (discount <= 0n) {
      throw new BadRequestException('coupon produced a zero discount');
    }
    return {
      couponId: coupon.id,
      code: coupon.code,
      discountAmount: discount,
      subtotal,
      total: subtotal - discount,
      currency: currency.toUpperCase(),
    };
  }

  async previewByCode(
    code: string,
    subtotal: bigint,
    currency: string,
  ): Promise<DiscountQuote> {
    const coupon = await this.findByCode(code);
    return this.quote(coupon, subtotal, currency);
  }

  // Called by OrdersService inside its create transaction. Takes a pessimistic
  // write lock on the coupon row so two concurrent redemptions can't both see
  // "one seat left" and both succeed. The UNIQUE(order_id) on the redemption
  // table is the second line of defense against a retried request that already
  // consumed this coupon for the same order.
  async redeemInTransaction(
    manager: EntityManager,
    params: {
      code: string;
      orderId: string;
      userId: string;
      subtotal: bigint;
      currency: string;
    },
  ): Promise<DiscountQuote> {
    const code = params.code.toUpperCase();
    const coupon = await manager
      .createQueryBuilder(CouponEntity, 'c')
      .setLock('pessimistic_write')
      .where('c.code = :code', { code })
      .getOne();
    if (!coupon) throw new NotFoundException(`unknown coupon: ${params.code}`);

    const quote = this.quote(coupon, params.subtotal, params.currency);

    coupon.redeemedCount += 1;
    await manager.save(coupon);

    try {
      await manager.save(
        manager.create(CouponRedemptionEntity, {
          couponId: coupon.id,
          orderId: params.orderId,
          userId: params.userId,
          discountAmount: quote.discountAmount.toString(),
        }),
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Same order tried to redeem twice — either an internal bug or a
        // retry after the txn already committed. Surface as 409 so the caller
        // can decide (typically: re-read the order).
        throw new ConflictException('coupon already applied to this order');
      }
      throw err;
    }
    return quote;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof QueryFailedError &&
    (err as unknown as { code?: string }).code === UNIQUE_VIOLATION
  );
}

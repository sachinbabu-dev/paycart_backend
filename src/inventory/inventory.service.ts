import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import {
  EVENT_BUS,
  type DomainEvent,
  type EventBus,
} from '../common/event-bus/event-bus.interface';
import {
  PAYMENT_EVENT_TYPES,
  type PaymentSucceededPayload,
} from '../payments/payment-events';
import { InventoryEntity } from './inventory.entity';
import { StockAdjustmentEntity } from './stock-adjustment.entity';

const UNIQUE_VIOLATION = '23505';

@Injectable()
export class InventoryService implements OnModuleInit {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    @InjectRepository(InventoryEntity)
    private readonly inventory: Repository<InventoryEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe<PaymentSucceededPayload>(
      PAYMENT_EVENT_TYPES.Succeeded,
      (event) => this.handlePaymentSucceeded(event),
    );
  }

  async getStock(productId: string): Promise<InventoryEntity | null> {
    return this.inventory.findOne({ where: { productId } });
  }

  async list(): Promise<InventoryEntity[]> {
    return this.inventory.find({ order: { productId: 'ASC' } });
  }

  // Admin override — sets absolute stock. Bypasses the ledger because this is
  // a manual restock, not a domain event decrement. Uses upsert so it works
  // whether the product row exists or not.
  async setStock(
    productId: string,
    stockQuantity: number,
  ): Promise<InventoryEntity> {
    await this.inventory.upsert(
      { productId, stockQuantity },
      { conflictPaths: ['productId'] },
    );
    const row = await this.inventory.findOne({ where: { productId } });
    if (!row) {
      // Practically unreachable after upsert; keeps the return type honest.
      throw new Error(`inventory row missing after upsert: ${productId}`);
    }
    return row;
  }

  private async handlePaymentSucceeded(
    event: DomainEvent<PaymentSucceededPayload>,
  ): Promise<void> {
    const { paymentId, orderId, items } = event.payload;
    for (const item of items) {
      await this.decrement(paymentId, orderId, item.productId, item.quantity);
    }
  }

  private async decrement(
    paymentId: string,
    orderId: string,
    productId: string,
    quantity: number,
  ): Promise<void> {
    const idempotencyKey = `${paymentId}:${productId}`;
    try {
      await this.dataSource.transaction(async (manager) => {
        // Ledger insert first — if this conflicts, we've already processed
        // this (paymentId, productId) and the txn rolls back cleanly.
        await manager.save(
          manager.create(StockAdjustmentEntity, {
            idempotencyKey,
            orderId,
            productId,
            delta: -quantity,
          }),
        );

        // Row-level UPDATE with lock so concurrent decrements can't race.
        // If the product isn't seeded, we insert a zero row so decrements
        // still create a negative-stock trail we can spot in dev.
        const inv = await manager
          .createQueryBuilder(InventoryEntity, 'i')
          .setLock('pessimistic_write')
          .where('i.product_id = :productId', { productId })
          .getOne();
        if (!inv) {
          await manager.save(
            manager.create(InventoryEntity, {
              productId,
              stockQuantity: -quantity,
            }),
          );
          this.logger.warn(
            `decremented unknown product ${productId}; created row at ${-quantity}`,
          );
          return;
        }
        inv.stockQuantity -= quantity;
        await manager.save(inv);
      });
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        (err as unknown as { code?: string }).code === UNIQUE_VIOLATION
      ) {
        this.logger.debug(
          `duplicate decrement for ${idempotencyKey}, skipping`,
        );
        return;
      }
      throw err;
    }
  }
}

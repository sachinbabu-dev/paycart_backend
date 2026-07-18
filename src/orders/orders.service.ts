import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { OutboxService } from '../common/outbox/outbox.service';
import { ProductType } from '../products/product-type';
import { ProductsService } from '../products/products.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderEventEntity } from './entities/order-event.entity';
import { OrderItemEntity } from './entities/order-item.entity';
import { OrderEntity } from './entities/order.entity';
import { OrderStateMachine } from './order-state-machine';
import { OrderStatus } from './order-status';
import { ORDER_EVENT_TYPES } from './order-events';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(OrderEntity) private readonly orders: Repository<OrderEntity>,
    @InjectRepository(OrderEventEntity)
    private readonly orderEvents: Repository<OrderEventEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly outbox: OutboxService,
    private readonly products: ProductsService,
  ) {}

  async create(userId: string, dto: CreateOrderDto): Promise<OrderEntity> {
    const skus = dto.items.map((i) => i.productId);
    const catalog = await this.products.findMapBySkus(skus);

    // Fail-fast validation before we open a transaction. Collect ALL problems
    // so the client gets one 400 instead of guess-and-check retries.
    const missing = skus.filter((sku) => !catalog.has(sku));
    if (missing.length > 0) {
      throw new BadRequestException(`unknown product(s): ${missing.join(', ')}`);
    }
    const inactive = skus.filter((sku) => catalog.get(sku)?.active === false);
    if (inactive.length > 0) {
      throw new BadRequestException(`inactive product(s): ${inactive.join(', ')}`);
    }
    // Recurring products belong to the subscriptions module (not yet built).
    // Reject at the boundary so nothing silently mis-charges as one-time.
    const recurring = skus.filter(
      (sku) => catalog.get(sku)?.type === ProductType.Recurring,
    );
    if (recurring.length > 0) {
      throw new BadRequestException(
        `recurring product(s) must go through subscriptions, not orders: ${recurring.join(', ')}`,
      );
    }
    const currencies = new Set(
      Array.from(catalog.values()).map((p) => p.currency.toUpperCase()),
    );
    if (currencies.size > 1) {
      throw new BadRequestException(
        `mixed-currency orders are not supported (${Array.from(currencies).join(', ')})`,
      );
    }
    const currency = currencies.values().next().value ?? 'USD';

    let totalAmount = 0n;
    const itemRows = dto.items.map((item) => {
      const product = catalog.get(item.productId);
      if (!product) throw new NotFoundException('product not found');
      const unitPrice = BigInt(product.unitPrice);
      totalAmount += unitPrice * BigInt(item.quantity);
      return { product, quantity: item.quantity, unitPrice };
    });

    return this.dataSource.transaction(async (manager) => {
      const order = manager.create(OrderEntity, {
        userId,
        status: OrderStatus.Pending,
        totalAmount: totalAmount.toString(),
        currency,
        items: itemRows.map((row) =>
          manager.create(OrderItemEntity, {
            productId: row.product.sku,
            quantity: row.quantity,
            unitPrice: row.unitPrice.toString(),
          }),
        ),
      });
      const saved = await manager.save(order);
      await this.recordEvent(manager, {
        orderId: saved.id,
        eventType: ORDER_EVENT_TYPES.Created,
        toStatus: OrderStatus.Pending,
        payload: { totalAmount: saved.totalAmount, currency: saved.currency },
      });
      await this.outbox.append(manager, {
        aggregateType: 'order',
        aggregateId: saved.id,
        eventType: ORDER_EVENT_TYPES.Created,
        payload: {
          orderId: saved.id,
          userId: saved.userId,
          totalAmount: saved.totalAmount,
          currency: saved.currency,
        },
      });
      return saved;
    });
  }

  async findById(id: string): Promise<OrderEntity> {
    const order = await this.orders.findOne({ where: { id } });
    if (!order) throw new NotFoundException('order not found');
    return order;
  }

  async findByIdForUser(id: string, userId: string): Promise<OrderEntity> {
    const order = await this.findById(id);
    if (order.userId !== userId) throw new NotFoundException('order not found');
    return order;
  }

  async listEvents(orderId: string, userId: string): Promise<OrderEventEntity[]> {
    await this.findByIdForUser(orderId, userId);
    return this.orderEvents.find({
      where: { orderId },
      order: { createdAt: 'ASC' },
    });
  }

  // Called by payments module (via internal call for state transition + audit).
  // The event that triggered the transition is passed in for the audit row.
  async transitionInTransaction(
    manager: EntityManager,
    orderId: string,
    to: OrderStatus,
    eventType: string,
    payload?: Record<string, unknown>,
  ): Promise<OrderEntity> {
    // Row-level lock so concurrent webhook + admin actions can't race.
    const order = await manager
      .createQueryBuilder(OrderEntity, 'o')
      .setLock('pessimistic_write')
      .where('o.id = :id', { id: orderId })
      .getOne();
    if (!order) throw new NotFoundException('order not found');

    OrderStateMachine.assertTransition(order.status, to);
    const from = order.status;
    order.status = to;
    const saved = await manager.save(order);

    await this.recordEvent(manager, {
      orderId: saved.id,
      eventType,
      fromStatus: from,
      toStatus: to,
      payload: payload ?? null,
    });
    return saved;
  }

  private async recordEvent(
    manager: EntityManager,
    input: {
      orderId: string;
      eventType: string;
      fromStatus?: OrderStatus | null;
      toStatus?: OrderStatus | null;
      payload?: Record<string, unknown> | null;
    },
  ): Promise<void> {
    await manager.save(
      manager.create(OrderEventEntity, {
        orderId: input.orderId,
        eventType: input.eventType,
        fromStatus: input.fromStatus ?? null,
        toStatus: input.toStatus ?? null,
        payload: input.payload ?? null,
      }),
    );
  }
}

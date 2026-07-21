import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, QueryFailedError, Repository } from 'typeorm';
import { ProductEntity } from './product.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

const UNIQUE_VIOLATION = '23505';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(ProductEntity)
    private readonly products: Repository<ProductEntity>,
  ) {}

  list(): Promise<ProductEntity[]> {
    return this.products.find({
      where: { active: true },
      order: { sku: 'ASC' },
    });
  }

  async findBySku(sku: string): Promise<ProductEntity> {
    const product = await this.products.findOne({ where: { sku } });
    if (!product) throw new NotFoundException(`unknown product: ${sku}`);
    return product;
  }

  // Bulk lookup used by orders on checkout. Returns a map so callers can
  // detect missing SKUs cheaply and produce a single 400 listing them.
  async findMapBySkus(skus: string[]): Promise<Map<string, ProductEntity>> {
    if (skus.length === 0) return new Map();
    const rows = await this.products.find({ where: { sku: In(skus) } });
    return new Map(rows.map((p) => [p.sku, p]));
  }

  async create(dto: CreateProductDto): Promise<ProductEntity> {
    try {
      return await this.products.save(
        this.products.create({
          sku: dto.sku,
          name: dto.name,
          description: dto.description ?? null,
          type: dto.type,
          unitPrice: String(dto.unitPrice),
          currency: dto.currency.toUpperCase(),
          billingInterval: dto.billingInterval ?? null,
          active: dto.active ?? true,
        }),
      );
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        (err as unknown as { code?: string }).code === UNIQUE_VIOLATION
      ) {
        throw new ConflictException(`sku already exists: ${dto.sku}`);
      }
      throw err;
    }
  }

  async update(sku: string, dto: UpdateProductDto): Promise<ProductEntity> {
    const product = await this.findBySku(sku);
    if (dto.name !== undefined) product.name = dto.name;
    if (dto.description !== undefined) product.description = dto.description;
    if (dto.unitPrice !== undefined) product.unitPrice = String(dto.unitPrice);
    if (dto.billingInterval !== undefined) {
      product.billingInterval = dto.billingInterval;
    }
    if (dto.active !== undefined) product.active = dto.active;
    return this.products.save(product);
  }

  // Soft-delete only — historical orders reference SKUs as plain strings, so
  // hard-deleting would leave order_items pointing at a name/price that no
  // longer exists. Sets active=false so the catalog stops listing it.
  async deactivate(sku: string): Promise<ProductEntity> {
    const product = await this.findBySku(sku);
    if (!product.active) return product;
    product.active = false;
    return this.products.save(product);
  }
}

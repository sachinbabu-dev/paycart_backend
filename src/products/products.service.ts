import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ProductEntity } from './product.entity';

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
}

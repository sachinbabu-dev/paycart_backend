import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderEventEntity } from './entities/order-event.entity';
import { OrderEntity } from './entities/order.entity';
import { OrdersService } from './orders.service';

@ApiTags('orders')
@ApiBearerAuth('access-token')
@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new order in "pending" state.' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOrderDto,
  ): Promise<OrderEntity> {
    return this.orders.create(user.id, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an order by ID (owner only).' })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderEntity> {
    return this.orders.findByIdForUser(id, user.id);
  }

  @Get(':id/events')
  @ApiOperation({
    summary: 'Get the append-only timeline of state transitions for an order.',
  })
  listEvents(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderEventEntity[]> {
    return this.orders.listEvents(id, user.id);
  }
}

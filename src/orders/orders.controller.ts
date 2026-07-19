import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Observable } from 'rxjs';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtStreamAuthGuard } from '../auth/jwt-stream-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderEventEntity } from './entities/order-event.entity';
import { OrderEntity } from './entities/order.entity';
import { OrderStreamService } from './order-stream.service';
import { OrdersService } from './orders.service';

// Guards are declared per-method rather than at the class level: the SSE
// endpoint needs its own guard (browsers can't set an Authorization header
// on EventSource, so it accepts a scoped token via ?token=).
@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly orderStream: OrderStreamService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Create a new order in "pending" state.' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOrderDto,
  ): Promise<OrderEntity> {
    return this.orders.create(user.id, dto);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get an order by ID (owner only).' })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderEntity> {
    return this.orders.findByIdForUser(id, user.id);
  }

  @Get(':id/events')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get the append-only timeline of state transitions for an order.',
  })
  listEvents(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderEventEntity[]> {
    return this.orders.listEvents(id, user.id);
  }

  @Sse(':id/stream')
  @UseGuards(JwtStreamAuthGuard)
  @ApiOperation({
    summary: 'Live server-sent event stream of order + payment updates.',
    description:
      'Opens an SSE connection. First message is a snapshot (current order + full event history). Subsequent messages are pushed as `order.*` and `payment.*` events fire. Auth is via a scoped token from POST /auth/stream-token passed as ?token=. Kept-alive with periodic ping messages so idle proxies do not drop the connection.',
  })
  @ApiQuery({
    name: 'token',
    required: true,
    description: 'Short-lived stream-scoped JWT from POST /auth/stream-token.',
  })
  stream(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Observable<{ data: unknown }> {
    return this.orderStream.forOrder(id, user.id);
  }
}

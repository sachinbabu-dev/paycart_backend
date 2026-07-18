import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxEventEntity } from './outbox-event.entity';
import { OutboxPublisher } from './outbox.publisher';
import { OutboxService } from './outbox.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([OutboxEventEntity])],
  providers: [OutboxService, OutboxPublisher],
  exports: [OutboxService, TypeOrmModule],
})
export class OutboxModule {}

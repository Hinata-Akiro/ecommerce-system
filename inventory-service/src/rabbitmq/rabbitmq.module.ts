import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RabbitMQService } from './rabbitmq.service';
import { InventoryModule } from 'src/inventory/inventory.module';

@Module({
  imports: [ConfigModule, forwardRef(() => InventoryModule)],
  providers: [RabbitMQService],
  exports: [RabbitMQService],
})
export class RabbitMQModule {}

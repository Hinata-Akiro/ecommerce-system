import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { InventoryModule } from './inventory/inventory.module';
import { RabbitMQModule } from './rabbitmq/rabbitmq.module';

@Module({
  imports: [InventoryModule, RabbitMQModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

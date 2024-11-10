import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { Inventory, InventorySchema } from './schemas/inventory.schema';
import { InventoryRepository } from './inventory.repository';
import { ElasticsearchLoggerService } from './logging/elasticsearch-logger.service';
import { RabbitMQModule } from 'src/rabbitmq/rabbitmq.module';

@Module({
  imports: [
    MongooseModule.forRoot(
      process.env.MONGODB_URI || 'mongodb://localhost:27017/inventory',
    ),
    MongooseModule.forFeature([
      { name: Inventory.name, schema: InventorySchema },
    ]),
    forwardRef(() => RabbitMQModule),
  ],
  controllers: [InventoryController],
  providers: [
    InventoryService,
    InventoryRepository,
    {
      provide: 'ELASTICSEARCH_HOST',
      useValue: process.env.ELASTICSEARCH_HOST || 'http://localhost:9200',
    },
    ElasticsearchLoggerService,
  ],
  exports: [InventoryService],
})
export class InventoryModule {}

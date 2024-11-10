import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrderController } from './order.controller';
import { OrderService } from './orders.service';
import { Order, OrderSchema } from './schemas/order.schema';
import { OrderRepository } from './repository/order.repository';
import { ElasticsearchLoggerService } from './logging/elasticsearch-logger.service';
import { RabbitMQModule } from 'src/rabbitmq/rabbitmq.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Order.name, schema: OrderSchema }]),
    RabbitMQModule,
  ],
  controllers: [OrderController],
  providers: [
    OrderService,
    OrderRepository,
    {
      provide: 'ELASTICSEARCH_HOST',
      useValue: process.env.ELASTICSEARCH_HOST || 'http://localhost:9200',
    },
    ElasticsearchLoggerService,
  ],
})
export class OrderModule {}

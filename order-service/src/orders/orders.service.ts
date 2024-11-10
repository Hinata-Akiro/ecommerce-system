import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { OrderRepository } from './repository/order.repository';
import { CreateOrderDto } from './dtos/create-order.dto';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { OrderStatus } from './enums/order.enums';
import { ElasticsearchLoggerService } from './logging/elasticsearch-logger.service';
import {
  RabbitMQExchanges,
  StockCheckResponse,
  StockUpdateEvent,
} from '../rabbitmq/rabbitmq.types';
import { Order } from './schemas/order.schema';

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private readonly orderRepository: OrderRepository,
    private readonly rabbitMQService: RabbitMQService,
    private readonly elasticLogger: ElasticsearchLoggerService,
  ) {}

  async createOrder(createOrderDto: CreateOrderDto): Promise<Order> {
    try {
      // Check stock availability
      this.logger.debug(
        `Checking stock for product: ${createOrderDto.productCode}`,
      );
      const stockCheckResponse =
        await this.rabbitMQService.publishWithResponse<StockCheckResponse>(
          RabbitMQExchanges.INVENTORY,
          'inventory.stock.check',
          {
            items: [
              {
                productCode: createOrderDto.productCode,
                quantity: createOrderDto.quantity,
              },
            ],
          },
        );
      this.logger.debug('Stock check response:', stockCheckResponse);

      if (!stockCheckResponse.success) {
        await this.elasticLogger.logOrderEvent(
          'Stock check failed',
          stockCheckResponse.message,
        );
        throw new HttpException(
          stockCheckResponse.message || 'Insufficient stock available',
          HttpStatus.BAD_REQUEST,
        );
      }

      const totalPrice =
        createOrderDto.quantity *
        stockCheckResponse.availableStock[createOrderDto.productCode];

      // Create order with PENDING status
      const order = await this.orderRepository.createOrder(
        {
          ...createOrderDto,
          totalPrice,
        },
        OrderStatus.PENDING,
      );

      try {
        // Request stock deduction with response
        const deductionResponse =
          await this.rabbitMQService.publishWithResponse<StockCheckResponse>(
            RabbitMQExchanges.INVENTORY,
            'inventory.stock.deduct',
            {
              orderId: order.id,
              items: [
                {
                  productCode: createOrderDto.productCode,
                  quantity: createOrderDto.quantity,
                },
              ],
            },
          );

        if (!deductionResponse.success) {
          throw new Error(
            deductionResponse.message || 'Stock deduction failed',
          );
        }

        // Update order status to CONFIRMED
        const confirmedOrder = await this.orderRepository.updateOrderStatus(
          order.id,
          OrderStatus.CONFIRMED,
        );

        await this.elasticLogger.logOrderEvent(
          'Order confirmed',
          `Order ${order.id} confirmed successfully with total price ${totalPrice}`,
        );

        return confirmedOrder;
      } catch (error) {
        // Handle stock deduction failure
        await this.orderRepository.updateOrderStatus(
          order.id,
          OrderStatus.FAILED,
        );

        await this.elasticLogger.logOrderEvent(
          'Stock deduction failed',
          error.stack,
        );

        throw new HttpException(
          'Failed to process order',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    } catch (error) {
      await this.elasticLogger.logOrderEvent(
        'Order creation failed',
        error.stack,
      );
      throw error;
    }
  }

  async getOrder(orderId: string): Promise<Order> {
    try {
      const order = await this.orderRepository.findOrderById(orderId);
      if (!order) {
        throw new HttpException('Order not found', HttpStatus.NOT_FOUND);
      }
      return order;
    } catch (error) {
      await this.elasticLogger.logOrderEvent(
        'Failed to fetch order',
        error.stack,
      );
      throw error;
    }
  }

  async handleStockUpdate(event: StockUpdateEvent): Promise<void> {
    try {
      await this.elasticLogger.logOrderEvent(
        'Stock Update',
        `Product ${event.productCode}: ${event.previousQuantity} → ${event.newQuantity}`,
      );

      this.logger.log(`Stock update logged for product ${event.productCode}`);
    } catch (error) {
      this.logger.error('Failed to handle stock update', error.stack);
      await this.elasticLogger.logOrderEvent(
        'Failed to handle stock update',
        error.stack,
      );
      console.error('Failed to handle stock update', error);
    }
  }
}

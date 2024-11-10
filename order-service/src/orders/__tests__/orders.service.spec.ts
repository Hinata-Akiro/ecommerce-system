import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { OrderService } from '../orders.service';
import { OrderRepository } from '../repository/order.repository';
import { RabbitMQService } from '../../rabbitmq/rabbitmq.service';
import { ElasticsearchLoggerService } from '../logging/elasticsearch-logger.service';
import { OrderStatus } from '../enums/order.enums';
import {
  RabbitMQExchanges,
  InventoryEventType,
} from '../../rabbitmq/rabbitmq.types';

describe('OrderService', () => {
  let service: OrderService;
  let orderRepository: jest.Mocked<OrderRepository>;
  let rabbitMQService: jest.Mocked<RabbitMQService>;
  let elasticLogger: jest.Mocked<ElasticsearchLoggerService>;

  const mockOrder = {
    id: 'ORDER-123',
    productCode: 'PROD-1',
    quantity: 2,
    totalPrice: 200,
    status: OrderStatus.PENDING,
  } as any;

  const mockCreateOrderDto = {
    productCode: 'PROD-1',
    quantity: 2,
  };

  beforeEach(async () => {
    const mockOrderRepository = {
      createOrder: jest.fn(),
      findOrderById: jest.fn(),
      updateOrderStatus: jest.fn(),
    };

    const mockRabbitMQService = {
      publishWithResponse: jest.fn(),
    };

    const mockElasticLogger = {
      logOrderEvent: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        {
          provide: OrderRepository,
          useValue: mockOrderRepository,
        },
        {
          provide: RabbitMQService,
          useValue: mockRabbitMQService,
        },
        {
          provide: ElasticsearchLoggerService,
          useValue: mockElasticLogger,
        },
      ],
    }).compile();

    service = module.get<OrderService>(OrderService);
    orderRepository = module.get(OrderRepository);
    rabbitMQService = module.get(RabbitMQService);
    elasticLogger = module.get(ElasticsearchLoggerService);
  });

  describe('createOrder', () => {
    it('should create order successfully when stock is available', async () => {
      // Mock successful stock check
      const stockCheckResponse = {
        success: true,
        availableStock: {
          'PROD-1': 100, // price per unit
        },
      };
      rabbitMQService.publishWithResponse
        .mockResolvedValueOnce(stockCheckResponse) // For stock check
        .mockResolvedValueOnce({ success: true }); // For stock deduction

      orderRepository.createOrder.mockResolvedValue(mockOrder);
      orderRepository.updateOrderStatus.mockResolvedValue({
        ...mockOrder,
        status: OrderStatus.CONFIRMED,
      });

      const result = await service.createOrder(mockCreateOrderDto);

      expect(rabbitMQService.publishWithResponse).toHaveBeenCalledWith(
        RabbitMQExchanges.INVENTORY,
        'inventory.stock.check',
        expect.any(Object),
      );
      expect(orderRepository.createOrder).toHaveBeenCalled();
      expect(orderRepository.updateOrderStatus).toHaveBeenCalledWith(
        mockOrder.id,
        OrderStatus.CONFIRMED,
      );
      expect(result.status).toBe(OrderStatus.CONFIRMED);
    });

    it('should throw error when stock check fails', async () => {
      const stockCheckResponse = {
        success: false,
        message: 'Insufficient stock',
      };
      rabbitMQService.publishWithResponse.mockResolvedValueOnce(
        stockCheckResponse,
      );

      await expect(service.createOrder(mockCreateOrderDto)).rejects.toThrow(
        new HttpException('Insufficient stock', HttpStatus.BAD_REQUEST),
      );

      expect(elasticLogger.logOrderEvent).toHaveBeenCalled();
    });

    it('should handle stock deduction failure', async () => {
      // Mock successful stock check but failed deduction
      rabbitMQService.publishWithResponse
        .mockResolvedValueOnce({
          success: true,
          availableStock: { 'PROD-1': 100 },
        })
        .mockResolvedValueOnce({
          success: false,
          message: 'Deduction failed',
        });

      orderRepository.createOrder.mockResolvedValue(mockOrder);
      orderRepository.updateOrderStatus.mockResolvedValue({
        ...mockOrder,
        status: OrderStatus.FAILED,
      });

      await expect(service.createOrder(mockCreateOrderDto)).rejects.toThrow(
        new HttpException(
          'Failed to process order',
          HttpStatus.INTERNAL_SERVER_ERROR,
        ),
      );

      expect(orderRepository.updateOrderStatus).toHaveBeenCalledWith(
        mockOrder.id,
        OrderStatus.FAILED,
      );
    });
  });

  describe('getOrder', () => {
    it('should return order when found', async () => {
      orderRepository.findOrderById.mockResolvedValue(mockOrder);

      const result = await service.getOrder('ORDER-123');

      expect(result).toEqual(mockOrder);
      expect(orderRepository.findOrderById).toHaveBeenCalledWith('ORDER-123');
    });

    it('should throw NotFoundException when order not found', async () => {
      orderRepository.findOrderById.mockResolvedValue(null);

      await expect(service.getOrder('INVALID-ID')).rejects.toThrow(
        new HttpException('Order not found', HttpStatus.NOT_FOUND),
      );
    });
  });

  describe('handleStockUpdate', () => {
    it('should log stock update successfully', async () => {
      const stockUpdateEvent = {
        productCode: 'PROD-1',
        previousQuantity: 10,
        newQuantity: 8,
        eventType: InventoryEventType.STOCK_UPDATED,
        timestamp: new Date(),
      };

      await service.handleStockUpdate(stockUpdateEvent);

      expect(elasticLogger.logOrderEvent).toHaveBeenCalledWith(
        'Stock Update',
        expect.stringContaining('PROD-1'),
      );
    });

    it('should handle logging error gracefully', async () => {
      const stockUpdateEvent = {
        productCode: 'PROD-1',
        previousQuantity: 10,
        newQuantity: 8,
        eventType: InventoryEventType.STOCK_UPDATED,
        timestamp: new Date(),
      };

      elasticLogger.logOrderEvent.mockRejectedValue(
        new Error('Logging failed'),
      );

      await service.handleStockUpdate(stockUpdateEvent);

      expect(elasticLogger.logOrderEvent).toHaveBeenCalled();
    });
  });
});

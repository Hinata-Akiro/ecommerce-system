/* eslint-disable @typescript-eslint/no-unused-vars */
import { Test, TestingModule } from '@nestjs/testing';
import { InventoryService } from '../inventory.service';
import { InventoryRepository } from '../inventory.repository';
import { ElasticsearchLoggerService } from '../logging/elasticsearch-logger.service';
import { RabbitMQService } from '../../rabbitmq/rabbitmq.service';
import { NotFoundException } from '@nestjs/common';
import { InventoryEventType } from '../events/inventory.events';

describe('InventoryService', () => {
  let service: InventoryService;
  let repository: jest.Mocked<InventoryRepository>;
  let logger: jest.Mocked<ElasticsearchLoggerService>;
  let rabbitMQService: jest.Mocked<RabbitMQService>;

  const mockInventoryItem = {
    _id: 'mock-id-123',
    productCode: 'INV-123456789',
    name: 'Test Product',
    description: 'Test Description',
    quantity: 10,
    price: 100,
    save: jest.fn(),
    toObject: jest.fn().mockReturnThis(),
    $assertPopulated: jest.fn(),
    $clearModifiedPaths: jest.fn(),
    $clone: jest.fn(),
  } as any;

  beforeEach(async () => {
    const mockRepository = {
      findItemById: jest.fn(),
      createItem: jest.fn(),
      updateStock: jest.fn(),
    };

    const mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
    };

    const mockRabbitMQService = {
      publish: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        {
          provide: InventoryRepository,
          useValue: mockRepository,
        },
        {
          provide: ElasticsearchLoggerService,
          useValue: mockLogger,
        },
        {
          provide: RabbitMQService,
          useValue: mockRabbitMQService,
        },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
    repository = module.get(InventoryRepository);
    logger = module.get(ElasticsearchLoggerService);
    rabbitMQService = module.get(RabbitMQService);
  });

  describe('checkStock', () => {
    it('should return available true when sufficient stock exists', async () => {
      repository.findItemById.mockResolvedValue(mockInventoryItem);

      const result = await service.checkStock('INV-123456789', 5);

      expect(result).toEqual({
        available: true,
        message: 'Stock available',
        currentStock: 10,
      });
    });

    it('should return available false when insufficient stock', async () => {
      repository.findItemById.mockResolvedValue(mockInventoryItem);

      const result = await service.checkStock('INV-123456789', 15);

      expect(result).toEqual({
        available: false,
        message: 'Insufficient stock. Requested: 15, Available: 10',
        currentStock: 10,
      });
    });

    it('should return available false when item not found', async () => {
      repository.findItemById.mockResolvedValue(null);

      const result = await service.checkStock('INV-999999999', 5);

      expect(result).toEqual({
        available: false,
        message: 'Item not found in inventory',
        currentStock: 0,
      });
    });
  });

  describe('deductStock', () => {
    beforeEach(() => {
      mockInventoryItem.quantity = 10;
    });

    it('should successfully deduct stock and publish event', async () => {
      repository.findItemById.mockResolvedValue(mockInventoryItem);

      await service.deductStock('INV-123456789', 5);

      expect(mockInventoryItem.quantity).toBe(5);
      expect(mockInventoryItem.save).toHaveBeenCalled();
      expect(rabbitMQService.publish).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          eventType: InventoryEventType.STOCK_REDUCED,
          previousQuantity: 10,
          newQuantity: 5,
        }),
      );
    });

    it('should throw error when insufficient stock', async () => {
      repository.findItemById.mockResolvedValue(mockInventoryItem);

      await expect(service.deductStock('INV-123456789', 15)).rejects.toThrow(
        'Insufficient stock for Test Product. Requested: 15, Available: 10',
      );
    });

    it('should throw NotFoundException when item not found', async () => {
      repository.findItemById.mockResolvedValue(null);

      await expect(service.deductStock('INV-999999999', 5)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateStock', () => {
    it('should update stock and publish event when quantity increased', async () => {
      repository.findItemById.mockResolvedValue(mockInventoryItem);
      repository.updateStock.mockResolvedValue({
        ...mockInventoryItem,
        quantity: 15,
      });

      await service.updateStock('INV-123456789', 15);

      expect(rabbitMQService.publish).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('inventory.stock.stock_added'),
        expect.objectContaining({
          eventType: InventoryEventType.STOCK_ADDED,
        }),
      );
    });

    it('should update stock and publish event when quantity decreased', async () => {
      repository.findItemById.mockResolvedValue(mockInventoryItem);
      repository.updateStock.mockResolvedValue({
        ...mockInventoryItem,
        quantity: 5,
      });

      await service.updateStock('INV-123456789', 5);

      expect(rabbitMQService.publish).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('inventory.stock.stock_reduced'),
        expect.objectContaining({
          eventType: InventoryEventType.STOCK_REDUCED,
        }),
      );
    });
  });
});

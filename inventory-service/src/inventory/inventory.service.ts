import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { CreateInventoryDto } from './dtos/create-inventory.dto';
import {
  InventoryEventType,
  StockUpdateEvent,
} from './events/inventory.events';
import { InventoryRepository } from './inventory.repository';
import { ElasticsearchLoggerService } from './logging/elasticsearch-logger.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { RabbitMQExchanges } from '../rabbitmq/rabbitmq.types';

@Injectable()
export class InventoryService {
  constructor(
    private readonly inventoryRepository: InventoryRepository,
    private readonly logger: ElasticsearchLoggerService,
    private readonly rabbitMQService: RabbitMQService,
  ) {}

  private generateProductCode(): string {
    const prefix = 'INV-';
    const randomNum = Math.floor(Math.random() * 1000000000)
      .toString()
      .padStart(9, '0');
    return `${prefix}${randomNum}`;
  }

  async generateUniqueProductCode(): Promise<string> {
    let productCode: string;
    let isUnique = false;

    while (!isUnique) {
      productCode = this.generateProductCode();
      const existingItem =
        await this.inventoryRepository.findItemById(productCode);
      if (!existingItem) {
        isUnique = true;
      }
    }
    return productCode;
  }

  async createItem(createDto: CreateInventoryDto) {
    if (!createDto.productCode) {
      createDto.productCode = await this.generateUniqueProductCode();
    } else {
      const existingItem = await this.inventoryRepository.findItemById(
        createDto.productCode,
      );
      if (existingItem) {
        throw new ConflictException(
          'Item with this product code already exists',
        );
      }
    }

    const savedItem = await this.inventoryRepository.createItem(createDto);

    const stockEvent: StockUpdateEvent = {
      eventType: InventoryEventType.STOCK_ADDED,
      productCode: savedItem.productCode,
      previousQuantity: 0,
      newQuantity: savedItem.quantity,
      timestamp: new Date(),
      productName: savedItem.name,
    };

    await this.publishStockUpdateEvent(stockEvent);
    await this.logger.log('Item created', savedItem.productCode);

    return savedItem;
  }

  async updateStock(productCode: string, quantity: number) {
    const item = await this.inventoryRepository.findItemById(productCode);
    if (!item) {
      throw new NotFoundException('Item not found');
    }

    const previousQuantity = item.quantity;
    const updatedItem = await this.inventoryRepository.updateStock(
      productCode,
      quantity,
    );

    const eventType =
      quantity > previousQuantity
        ? InventoryEventType.STOCK_ADDED
        : InventoryEventType.STOCK_REDUCED;

    const stockEvent: StockUpdateEvent = {
      eventType,
      productCode,
      previousQuantity,
      newQuantity: quantity,
      timestamp: new Date(),
      productName: item.name,
    };

    await this.publishStockUpdateEvent(stockEvent);

    await this.logger.log(
      `Stock updated for item ${item.name}. New stock: ${quantity}`,
      'InventoryService',
    );

    return updatedItem;
  }

  private async publishStockUpdateEvent(
    event: StockUpdateEvent,
  ): Promise<void> {
    try {
      await this.rabbitMQService.publish(
        RabbitMQExchanges.INVENTORY,
        `inventory.stock.${event.eventType.toLowerCase()}`,
        event,
      );

      await this.logger.log(
        `Published ${event.eventType} event for product ${event.productCode}`,
        'InventoryService',
      );
    } catch (error) {
      await this.logger.error(
        `Failed to publish stock update event: ${error.message}`,
        'InventoryService',
      );
      throw error;
    }
  }

  async getItem(productCode: string) {
    const item = await this.inventoryRepository.findItemById(productCode);
    if (!item) {
      throw new NotFoundException('Item not found');
    }
    this.logger.log(
      `Fetched stock for item ${item.name}: ${item?.productCode ?? 'not found'}`,
      'InventoryService',
    );
    return item;
  }

  async checkStock(
    productCode: string,
    quantity: number,
  ): Promise<{
    available: boolean;
    message: string;
    currentStock: number;
  }> {
    const inventory = await this.inventoryRepository.findItemById(productCode);

    if (!inventory) {
      await this.logger.log(
        `Stock check failed: Product ${productCode} not found`,
        'InventoryService',
      );
      return {
        available: false,
        message: 'Item not found in inventory',
        currentStock: 0,
      };
    }

    const available = inventory.quantity >= quantity;
    return {
      available,
      message: available
        ? 'Stock available'
        : `Insufficient stock. Requested: ${quantity}, Available: ${inventory.quantity}`,
      currentStock: inventory.quantity,
    };
  }

  async deductStock(productCode: string, quantity: number): Promise<void> {
    const inventory = await this.getItem(productCode);

    if (!inventory) {
      throw new NotFoundException('Item not found in inventory');
    }

    if (inventory.quantity < quantity) {
      throw new Error(
        `Insufficient stock for ${inventory.name}. Requested: ${quantity}, Available: ${inventory.quantity}`,
      );
    }

    inventory.quantity -= quantity;
    await inventory.save();

    const stockEvent: StockUpdateEvent = {
      eventType: InventoryEventType.STOCK_REDUCED,
      productCode,
      previousQuantity: inventory.quantity + quantity,
      newQuantity: inventory.quantity,
      timestamp: new Date(),
      productName: inventory.name,
    };

    await this.publishStockUpdateEvent(stockEvent);
  }
}

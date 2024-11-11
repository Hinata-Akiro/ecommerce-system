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
import { Inventory } from './schemas/inventory.schema';

@Injectable()
export class InventoryService {
  constructor(
    private readonly inventoryRepository: InventoryRepository,
    private readonly logger: ElasticsearchLoggerService,
    private readonly rabbitMQService: RabbitMQService,
  ) {}

  /**
   * Generates a random product code with 'INV-' prefix
   * @private
   * @returns {string} Generated product code
   */
  private generateProductCode(): string {
    const prefix = 'INV-';
    const randomNum = Math.floor(Math.random() * 1000000000)
      .toString()
      .padStart(9, '0');
    return `${prefix}${randomNum}`;
  }

  /**
   * Generates a unique product code by checking against existing codes
   * @returns {Promise<string>} Unique product code
   */
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

  /**
   * Creates a new inventory item
   * @param {CreateInventoryDto} createDto - The inventory item data
   * @throws {ConflictException} When product code already exists
   * @returns {Promise<Inventory>} Created inventory item
   */
  async createItem(createDto: CreateInventoryDto): Promise<Inventory> {
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

  /**
   * Updates the stock quantity of an inventory item
   * @param {string} productCode - Product identifier
   * @param {number} quantity - New quantity value
   * @throws {NotFoundException} When item is not found
   * @returns {Promise<Inventory>} Updated inventory item
   */
  async updateStock(productCode: string, quantity: number): Promise<Inventory> {
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

  /**
   * Publishes a stock update event to message queue
   * @param {StockUpdateEvent} event - Stock update event details
   * @throws {Error} When publishing fails
   * @returns {Promise<void>}
   */
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

  /**
   * Retrieves an inventory item by product code
   * @param {string} productCode - Product identifier
   * @throws {NotFoundException} When item is not found
   * @returns {Promise<any>} Inventory item
   */
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

  /**
   * Checks if requested quantity is available in stock
   * @param {string} productCode - Product identifier
   * @param {number} quantity - Requested quantity
   * @returns {Promise<{available: boolean, message: string, currentStock: number}>} Stock availability status
   */
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

  /**
   * Deducts quantity from inventory stock
   * @param {string} productCode - Product identifier
   * @param {number} quantity - Quantity to deduct
   * @throws {NotFoundException} When item is not found
   * @throws {Error} When insufficient stock
   * @returns {Promise<void>}
   */
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

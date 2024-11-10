import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection, Channel, connect } from 'amqplib';
import { RabbitMQExchanges, RabbitMQQueues } from './rabbitmq.types';
import { InventoryService } from '../inventory/inventory.service';

interface StockCheckItem {
  productCode: string;
  quantity: number;
}

@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
  private connection: Connection;
  private channel: Channel;
  private readonly logger = new Logger(RabbitMQService.name);
  private readonly maxRetries = 5;
  private readonly retryDelay = 5000;
  private isConnecting = false;

  constructor(
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => InventoryService))
    private readonly inventoryService: InventoryService,
  ) {}

  async onModuleInit() {
    await this.connectWithRetry();
  }

  async onModuleDestroy() {
    await this.cleanup();
  }

  private async connectWithRetry(retryCount = 0): Promise<void> {
    if (this.isConnecting) return;
    this.isConnecting = true;

    try {
      await this.connect();
      this.logger.log('RabbitMQ connection established successfully');
      this.isConnecting = false;
    } catch (error) {
      this.logger.error(
        `Failed to connect to RabbitMQ (Attempt ${retryCount + 1}/${this.maxRetries})`,
        error,
      );

      if (retryCount < this.maxRetries) {
        this.isConnecting = false;
        await new Promise((resolve) => setTimeout(resolve, this.retryDelay));
        return this.connectWithRetry(retryCount + 1);
      }

      this.isConnecting = false;
      this.logger.error(`Failed to connect after ${this.maxRetries} attempts`);
    }
  }

  private async connect(): Promise<void> {
    const url =
      this.configService.get<string>('RABBITMQ_URI') || 'amqp://rabbitmq:5672';
    this.connection = await connect(url);

    this.connection.on('error', (err) => {
      this.logger.error('RabbitMQ connection error', err);
      this.handleReconnect();
    });

    this.connection.on('close', () => {
      this.logger.error('RabbitMQ connection closed');
      this.handleReconnect();
    });

    this.channel = await this.connection.createChannel();

    // Assert exchange first
    await this.setupExchanges();

    // Assert queues before binding
    await this.channel.assertQueue(RabbitMQQueues.ORDER_STOCK_CHECK, {
      durable: true,
    });

    await this.channel.assertQueue(RabbitMQQueues.ORDER_STOCK_DEDUCT, {
      durable: true,
    });

    // Now bind the queues
    await this.channel.bindQueue(
      RabbitMQQueues.ORDER_STOCK_CHECK,
      RabbitMQExchanges.INVENTORY,
      'inventory.stock.check',
    );

    await this.channel.bindQueue(
      RabbitMQQueues.ORDER_STOCK_DEDUCT,
      RabbitMQExchanges.INVENTORY,
      'inventory.stock.deduct',
    );

    // Set up consumers
    await this.setupSubscriptions();
  }

  private async setupExchanges(): Promise<void> {
    // Assert exchange
    await this.channel.assertExchange(RabbitMQExchanges.INVENTORY, 'topic', {
      durable: true,
    });

    // Assert queues
    await this.channel.assertQueue(RabbitMQQueues.ORDER_STOCK_CHECK, {
      durable: true,
    });

    await this.channel.assertQueue(RabbitMQQueues.ORDER_STOCK_DEDUCT, {
      durable: true,
    });

    // Bind queues to exchange
    await this.channel.bindQueue(
      RabbitMQQueues.ORDER_STOCK_CHECK,
      RabbitMQExchanges.INVENTORY,
      'inventory.stock.check',
    );

    await this.channel.bindQueue(
      RabbitMQQueues.ORDER_STOCK_DEDUCT,
      RabbitMQExchanges.INVENTORY,
      'inventory.stock.deduct',
    );
  }

  private async handleReconnect(): Promise<void> {
    try {
      await this.cleanup();
      await this.connectWithRetry();
    } catch (error) {
      this.logger.error('Failed to reconnect to RabbitMQ', error);
    }
  }

  private async cleanup(): Promise<void> {
    try {
      if (this.channel) {
        await this.channel.close();
      }
      if (this.connection) {
        await this.connection.close();
      }
    } catch (error) {
      this.logger.error('Error during cleanup', error);
    }
  }

  async publish(
    exchange: string,
    routingKey: string,
    message: any,
  ): Promise<void> {
    if (!this.channel) {
      this.logger.warn(
        'RabbitMQ channel not available, attempting to reconnect...',
      );
      await this.connectWithRetry();
      if (!this.channel) {
        throw new Error('RabbitMQ channel is not initialized');
      }
    }

    try {
      await this.channel.publish(
        exchange,
        routingKey,
        Buffer.from(JSON.stringify(message)),
      );
      this.logger.log(
        `Published message to ${exchange} with routing key ${routingKey}`,
      );
    } catch (error) {
      this.logger.error(`Failed to publish message to ${exchange}`, error);
      await this.handleReconnect();
      if (this.channel) {
        await this.channel.publish(
          exchange,
          routingKey,
          Buffer.from(JSON.stringify(message)),
        );
      }
    }
  }

  async subscribe(
    queue: string,
    callback: (message: any) => void,
  ): Promise<void> {
    if (!this.channel) {
      await this.connectWithRetry();
    }

    try {
      const { queue: queueName } = await this.channel.assertQueue(queue, {
        durable: true,
      });

      await this.channel.consume(queueName, (msg) => {
        if (msg) {
          const content = JSON.parse(msg.content.toString());
          callback(content);
          this.channel.ack(msg);
        }
      });

      this.logger.log(`Subscribed to queue: ${queue}`);
    } catch (error) {
      this.logger.error(`Failed to subscribe to queue: ${queue}`, error);
      throw error;
    }
  }

  private async setupSubscriptions(): Promise<void> {
    // Handle stock check requests
    await this.channel.consume(
      RabbitMQQueues.ORDER_STOCK_CHECK,
      async (msg) => {
        if (!msg) return;

        try {
          const content = JSON.parse(msg.content.toString());
          const { items } = content;

          // Check stock for all items
          const stockCheckResults = await Promise.all(
            items.map(async (item: StockCheckItem) => {
              const result = await this.inventoryService.checkStock(
                item.productCode,
                item.quantity,
              );
              return {
                productCode: item.productCode,
                ...result,
              };
            }),
          );

          const responseMessage = {
            success: stockCheckResults.every((result) => result.available),
            message: stockCheckResults.every((result) => result.available)
              ? 'All items in stock'
              : stockCheckResults
                  .filter((result) => !result.available)
                  .map((result) => result.message)
                  .join('; '),
            availableStock: stockCheckResults.reduce((acc, result) => {
              acc[result.productCode] = result.currentStock;
              return acc;
            }, {}),
            details: stockCheckResults,
          };

          await this.channel.publish(
            '',
            msg.properties.replyTo,
            Buffer.from(JSON.stringify(responseMessage)),
            { correlationId: msg.properties.correlationId },
          );

          this.channel.ack(msg);
        } catch (error) {
          this.logger.error('Error processing stock check request', error);

          const errorResponse = {
            success: false,
            message: error.message,
            availableStock: {},
            details: [],
          };

          await this.channel.publish(
            '',
            msg.properties.replyTo,
            Buffer.from(JSON.stringify(errorResponse)),
            { correlationId: msg.properties.correlationId },
          );

          this.channel.ack(msg);
        }
      },
      { noAck: false },
    );

    // Handle stock deduction requests
    await this.channel.consume(
      RabbitMQQueues.ORDER_STOCK_DEDUCT,
      async (msg) => {
        if (!msg) return;

        try {
          const { items } = JSON.parse(msg.content.toString());

          // First check if all items are available
          const stockChecks = await Promise.all(
            items.map(async (item: StockCheckItem) => {
              const check = await this.inventoryService.checkStock(
                item.productCode,
                item.quantity,
              );
              return {
                ...item,
                available: check.available,
                currentStock: check.currentStock,
              };
            }),
          );

          const allAvailable = stockChecks.every((item) => item.available);

          if (!allAvailable) {
            throw new Error(
              'Some items are not available in requested quantity',
            );
          }

          // If all available, proceed with deduction
          await Promise.all(
            items.map(async (item: StockCheckItem) => {
              await this.inventoryService.deductStock(
                item.productCode,
                item.quantity,
              );
            }),
          );

          const response = {
            success: true,
            message: 'Stock deducted successfully',
            deductions: items.map((item) => ({
              productCode: item.productCode,
              quantity: item.quantity,
            })),
          };

          await this.channel.publish(
            '',
            msg.properties.replyTo,
            Buffer.from(JSON.stringify(response)),
            { correlationId: msg.properties.correlationId },
          );

          this.channel.ack(msg);
        } catch (error) {
          this.logger.error('Error processing stock deduction', error);

          const errorResponse = {
            success: false,
            message: error.message || 'Failed to deduct stock',
          };

          await this.channel.publish(
            '',
            msg.properties.replyTo,
            Buffer.from(JSON.stringify(errorResponse)),
            { correlationId: msg.properties.correlationId },
          );

          this.channel.ack(msg);
        }
      },
      { noAck: false },
    );
  }

  private async publishStockUpdate(
    productCode: string,
    quantity: number,
    eventType: string,
  ): Promise<void> {
    try {
      const inventory = await this.inventoryService.getItem(productCode);

      await this.channel.publish(
        RabbitMQExchanges.INVENTORY,
        'inventory.stock.updated',
        Buffer.from(
          JSON.stringify({
            eventType,
            productCode,
            previousQuantity: inventory.quantity + quantity,
            newQuantity: inventory.quantity,
            timestamp: new Date(),
            productName: inventory.name,
          }),
        ),
      );
    } catch (error) {
      this.logger.error('Failed to publish stock update', error);
    }
  }
}

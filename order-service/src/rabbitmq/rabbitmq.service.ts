/* eslint-disable @typescript-eslint/ban-types */
import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection, Channel, connect } from 'amqplib';
import {
  RabbitMQExchanges,
  RabbitMQQueues,
  StockUpdateEvent,
} from './rabbitmq.types';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
  private connection: Connection;
  private channel: Channel;
  private readonly logger = new Logger(RabbitMQService.name);
  private responseEmitter: Map<
    string,
    { resolve: Function; reject: Function; timer: NodeJS.Timeout }
  > = new Map();

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    await this.connect();
    await this.setupSubscriptions();
  }

  async onModuleDestroy() {
    await this.cleanup();
  }

  private async connect(): Promise<void> {
    try {
      const url =
        this.configService.get<string>('RABBITMQ_URI') ||
        'amqp://rabbitmq:5672';
      this.connection = await connect(url);
      this.channel = await this.connection.createChannel();

      // Setup exchanges
      await this.channel.assertExchange(RabbitMQExchanges.INVENTORY, 'topic', {
        durable: true,
      });
      await this.channel.assertExchange(RabbitMQExchanges.ORDER, 'topic', {
        durable: true,
      });

      // Setup queues
      await this.channel.assertQueue(RabbitMQQueues.ORDER_STOCK_CHECK, {
        durable: true,
      });
      await this.channel.assertQueue(RabbitMQQueues.ORDER_STOCK_DEDUCT, {
        durable: true,
      });
      await this.channel.assertQueue(RabbitMQQueues.INVENTORY_UPDATES, {
        durable: true,
      });

      // Bind queues to exchanges
      await this.channel.bindQueue(
        RabbitMQQueues.INVENTORY_UPDATES,
        RabbitMQExchanges.INVENTORY,
        'inventory.stock.*',
      );

      this.setupErrorHandlers();
    } catch (error) {
      this.logger.error('Failed to connect to RabbitMQ', error);
      throw error;
    }
  }

  private setupErrorHandlers(): void {
    this.connection.on('error', (error) => {
      this.logger.error('RabbitMQ Connection Error', error);
    });

    this.connection.on('close', async () => {
      this.logger.warn(
        'RabbitMQ Connection Closed. Attempting to reconnect...',
      );
      await this.reconnect();
    });
  }

  private async reconnect(): Promise<void> {
    try {
      await this.cleanup();
      await this.connect();
      await this.setupSubscriptions();
    } catch (error) {
      this.logger.error('Failed to reconnect to RabbitMQ', error);
      setTimeout(() => this.reconnect(), 5000);
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

  async publishWithResponse<T>(
    exchange: string,
    routingKey: string,
    message: any,
    timeout: number = 30000,
  ): Promise<T> {
    if (!this.channel) {
      throw new Error('Channel not initialized');
    }

    const correlationId = uuidv4();
    const replyTo = `response.${correlationId}`;

    try {
      // Create temporary response queue
      const { queue } = await this.channel.assertQueue(replyTo, {
        exclusive: true,
        autoDelete: true,
      });

      const responsePromise = new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.responseEmitter.delete(correlationId);
          this.channel
            .deleteQueue(queue)
            .catch((err) => this.logger.error('Error deleting queue', err));
          reject(new Error('Request timeout'));
        }, timeout);

        // Store the callbacks
        this.responseEmitter.set(correlationId, { resolve, reject, timer });

        // Listen for response
        this.channel.consume(
          queue,
          (msg) => {
            if (!msg) return;

            if (msg.properties.correlationId === correlationId) {
              const response = JSON.parse(msg.content.toString());
              const emitterData = this.responseEmitter.get(correlationId);

              if (emitterData) {
                clearTimeout(emitterData.timer);
                this.responseEmitter.delete(correlationId);
                resolve(response);
              }

              this.channel
                .deleteQueue(queue)
                .catch((err) => this.logger.error('Error deleting queue', err));
            }
          },
          { noAck: true },
        );
      });

      // Publish message
      await this.channel.publish(
        exchange,
        routingKey,
        Buffer.from(JSON.stringify(message)),
        {
          correlationId,
          replyTo,
        },
      );

      return responsePromise;
    } catch (error) {
      this.responseEmitter.delete(correlationId);
      await this.channel.deleteQueue(replyTo).catch(() => {});
      throw error;
    }
  }

  async publish(
    exchange: string,
    routingKey: string,
    message: any,
  ): Promise<void> {
    try {
      await this.channel.publish(
        exchange,
        routingKey,
        Buffer.from(JSON.stringify(message)),
      );
    } catch (error) {
      this.logger.error(`Failed to publish message to ${exchange}`, error);
      throw error;
    }
  }

  async subscribe(
    queue: string,
    callback: (message: any, originalMsg: any) => Promise<void>,
  ): Promise<void> {
    try {
      await this.channel.consume(queue, async (msg) => {
        try {
          const content = JSON.parse(msg.content.toString());
          await callback(content, msg);
          this.channel.ack(msg);
        } catch (error) {
          this.logger.error(
            `Error processing message from queue ${queue}`,
            error,
          );
          this.channel.nack(msg, false, false);
        }
      });
    } catch (error) {
      this.logger.error(`Failed to subscribe to queue ${queue}`, error);
      throw error;
    }
  }

  private async setupSubscriptions(): Promise<void> {
    // Listen for stock updates
    await this.subscribe(
      RabbitMQQueues.INVENTORY_UPDATES,
      async (event: StockUpdateEvent) => {
        this.logger.log(
          `Received stock update event: ${JSON.stringify(event)}`,
        );
      },
    );
  }

  async checkStock(items: Array<{ productCode: string; quantity: number }>) {
    try {
      const response = await this.publishWithResponse(
        RabbitMQExchanges.INVENTORY,
        'inventory.stock.check',
        { items },
        30000,
      );
      return response;
    } catch (error) {
      this.logger.error('Failed to check stock', error);
      throw error;
    }
  }

  async deductStock(
    orderId: string,
    items: Array<{ productCode: string; quantity: number }>,
  ) {
    try {
      const response = await this.publishWithResponse(
        RabbitMQExchanges.INVENTORY,
        'inventory.stock.deduct',
        { orderId, items },
        30000,
      );
      return response;
    } catch (error) {
      this.logger.error('Failed to deduct stock', error);
      throw error;
    }
  }
}

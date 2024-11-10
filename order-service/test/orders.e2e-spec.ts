import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';
import { RabbitMQService } from '../src/rabbitmq/rabbitmq.service';
import { OrderStatus } from '../src/orders/enums/order.enums';
import { ValidationPipe } from '@nestjs/common';

describe('OrderController (e2e)', () => {
  let app: INestApplication;
  let mockRabbitMQService: Partial<RabbitMQService>;

  beforeAll(async () => {
    // Mock RabbitMQ Service
    mockRabbitMQService = {
      onModuleInit: jest.fn(),
      onModuleDestroy: jest.fn(),
      publishWithResponse: jest.fn(),
      publish: jest.fn(),
      subscribe: jest.fn(),
      checkStock: jest.fn(),
      deductStock: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(RabbitMQService)
      .useValue(mockRabbitMQService)
      .compile();

    app = moduleFixture.createNestApplication();

    // Add these lines to match your main.ts configuration
    app.useGlobalPipes(new ValidationPipe());
    app.setGlobalPrefix('api/v1');

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('/api/v1/orders (POST)', () => {
    it('should create a new order when stock is available', async () => {
      // Mock successful stock check
      mockRabbitMQService.publishWithResponse = jest
        .fn()
        .mockImplementation((exchange, routingKey) => {
          if (routingKey === 'inventory.stock.check') {
            return Promise.resolve({
              success: true,
              availableStock: {
                'PROD-1': 100,
              },
            });
          } else if (routingKey === 'inventory.stock.deduct') {
            return Promise.resolve({
              success: true,
            });
          }
        });

      const createOrderDto = {
        productCode: 'PROD-1',
        quantity: 2,
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/orders')
        .send(createOrderDto)
        .expect(201);

      expect(response.body).toHaveProperty('_id');
      expect(response.body.status).toBe(OrderStatus.CONFIRMED);
      expect(response.body.productCode).toBe(createOrderDto.productCode);
      expect(response.body.quantity).toBe(createOrderDto.quantity);
    });

    it('should return 400 when stock is insufficient', async () => {
      mockRabbitMQService.publishWithResponse = jest.fn().mockResolvedValue({
        success: false,
        message: 'Insufficient stock',
      });

      const createOrderDto = {
        productCode: 'PROD-1',
        quantity: 1000,
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/orders')
        .send(createOrderDto)
        .expect(400);

      expect(response.body.message).toBe('Insufficient stock');
    });

    it('should validate request payload', async () => {
      const invalidOrderDto = {
        productCode: '',
        quantity: -1,
      };

      const response = await request(app.getHttpServer())
        .post('/api/v1/orders')
        .send(invalidOrderDto)
        .expect(400);

      expect(response.body.message).toEqual([
        'quantity must be a positive number',
      ]);
    });
  });

  describe('/api/v1/orders/:id (GET)', () => {
    it('should return order by id', async () => {
      // First create an order
      mockRabbitMQService.publishWithResponse = jest
        .fn()
        .mockImplementation((exchange, routingKey) => {
          if (routingKey === 'inventory.stock.check') {
            return Promise.resolve({
              success: true,
              availableStock: {
                'PROD-1': 100,
              },
            });
          } else if (routingKey === 'inventory.stock.deduct') {
            return Promise.resolve({
              success: true,
            });
          }
        });

      const createResponse = await request(app.getHttpServer())
        .post('/api/v1/orders')
        .send({
          productCode: 'PROD-1',
          quantity: 1,
        });

      // Then fetch it using the _id
      const orderId = createResponse.body._id;
      const response = await request(app.getHttpServer())
        .get(`/api/v1/orders/${orderId}`)
        .expect(200);

      expect(response.body._id).toBe(orderId);
      expect(response.body.productCode).toBe('PROD-1');
    });

    it('should return 404 for non-existent order', async () => {
      // Use a valid ObjectId format for non-existent ID
      await request(app.getHttpServer())
        .get('/api/v1/orders/507f1f77bcf86cd799439011')
        .expect(404);
    });
  });
});

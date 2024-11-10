import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, connect, Model } from 'mongoose';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { RabbitMQService } from '../../src/rabbitmq/rabbitmq.service';
import { OrderStatus } from '../../src/orders/enums/order.enums';
import { Order } from '../../src/orders/schemas/order.schema';
import { getModelToken } from '@nestjs/mongoose';

describe('Orders Integration Tests', () => {
  let app: INestApplication;
  let mongoServer: MongoMemoryServer;
  let mongoConnection: Connection;
  let orderModel: Model<Order>;
  let mockRabbitMQService: Partial<RabbitMQService>;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    mongoConnection = (await connect(mongoUri)).connection;

    mockRabbitMQService = {
      onModuleInit: jest.fn(),
      onModuleDestroy: jest.fn(),
      publishWithResponse: jest.fn(),
      publish: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(RabbitMQService)
      .useValue(mockRabbitMQService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    app.setGlobalPrefix('api/v1');

    orderModel = moduleFixture.get<Model<Order>>(getModelToken(Order.name));

    await app.init();
  });

  afterAll(async () => {
    await mongoConnection.close();
    await mongoServer.stop();
    await app.close();
  });

  beforeEach(async () => {
    await orderModel.deleteMany({});
    jest.clearAllMocks();
  });

  describe('POST /api/v1/orders', () => {
    it('should create an order when stock is available', async () => {
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
      expect(response.body.totalPrice).toBe(200); // 2 * 100

      // Verify order was saved in database
      const savedOrder = await orderModel.findById(response.body._id);
      expect(savedOrder).toBeTruthy();
      expect(savedOrder.status).toBe(OrderStatus.CONFIRMED);
    });

    it('should handle insufficient stock', async () => {
      mockRabbitMQService.publishWithResponse = jest.fn().mockResolvedValue({
        success: false,
        message: 'Insufficient stock',
      });

      const response = await request(app.getHttpServer())
        .post('/api/v1/orders')
        .send({
          productCode: 'PROD-1',
          quantity: 1000,
        })
        .expect(400);

      expect(response.body.message).toBe('Insufficient stock');
    });

    it('should validate order payload', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/orders')
        .send({
          productCode: 'PROD-1',
          quantity: -1,
        })
        .expect(400);

      expect(response.body.message).toEqual([
        'quantity must be a positive number',
      ]);
    });
  });

  describe('GET /api/v1/orders/:id', () => {
    it('should retrieve an existing order', async () => {
      // First create an order
      const order = await orderModel.create({
        productCode: 'PROD-1',
        quantity: 2,
        totalPrice: 200,
        status: OrderStatus.CONFIRMED,
      });

      const response = await request(app.getHttpServer())
        .get(`/api/v1/orders/${order._id}`)
        .expect(200);

      expect(response.body._id).toBe(order._id.toString());
      expect(response.body.productCode).toBe('PROD-1');
      expect(response.body.status).toBe(OrderStatus.CONFIRMED);
    });

    it('should return 404 for non-existent order', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/orders/507f1f77bcf86cd799439011')
        .expect(404);
    });
  });
});

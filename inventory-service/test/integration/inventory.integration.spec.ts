import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../../src/app.module';
import { Connection } from 'mongoose';
import { getConnectionToken } from '@nestjs/mongoose';
import { RabbitMQService } from '../../src/rabbitmq/rabbitmq.service';

describe('Inventory Integration Tests', () => {
  let app: INestApplication;
  let mongoConnection: Connection;

  const mockInventoryItem = {
    name: 'Test Product',
    description: 'Test Description',
    quantity: 100,
    price: 29.99,
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(RabbitMQService)
      .useValue({
        publish: jest.fn().mockResolvedValue(true),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    app.setGlobalPrefix('api/v1');

    mongoConnection = moduleFixture.get<Connection>(getConnectionToken());
    await app.init();
  });

  beforeEach(async () => {
    await mongoConnection.dropDatabase();
  });

  afterAll(async () => {
    await mongoConnection.close();
    await app.close();
  });

  describe('POST /api/v1/inventory', () => {
    it('should create a new inventory item', () => {
      return request(app.getHttpServer())
        .post('/api/v1/inventory')
        .send(mockInventoryItem)
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty('productCode');
          expect(res.body.name).toBe(mockInventoryItem.name);
          expect(res.body.quantity).toBe(mockInventoryItem.quantity);
          expect(res.body.price).toBe(mockInventoryItem.price);
        });
    });

    it('should reject invalid inventory data', () => {
      return request(app.getHttpServer())
        .post('/api/v1/inventory')
        .send({
          name: 'Test',
          quantity: -1,
          price: -10,
        })
        .expect(400);
    });

    it('should prevent duplicate product codes', async () => {
      const firstResponse = await request(app.getHttpServer())
        .post('/api/v1/inventory')
        .send(mockInventoryItem);

      return request(app.getHttpServer())
        .post('/api/v1/inventory')
        .send({
          ...mockInventoryItem,
          productCode: firstResponse.body.productCode,
        })
        .expect(409);
    });
  });

  describe('GET /api/v1/inventory/:productCode', () => {
    it('should retrieve an existing inventory item', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/api/v1/inventory')
        .send(mockInventoryItem);

      return request(app.getHttpServer())
        .get(`/api/v1/inventory/${createResponse.body.productCode}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.productCode).toBe(createResponse.body.productCode);
          expect(res.body.name).toBe(mockInventoryItem.name);
        });
    });

    it('should return 404 for non-existent product', () => {
      return request(app.getHttpServer())
        .get('/api/v1/inventory/INV-999999999')
        .expect(404);
    });
  });

  describe('PUT /api/v1/inventory/:productCode/stock', () => {
    it('should update stock quantity', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/api/v1/inventory')
        .send(mockInventoryItem);

      const newQuantity = 50;

      return request(app.getHttpServer())
        .put(`/api/v1/inventory/${createResponse.body.productCode}/stock`)
        .send({ quantity: newQuantity })
        .expect(200)
        .expect((res) => {
          expect(res.body.quantity).toBe(newQuantity);
        });
    });

    it('should reject negative stock quantities', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/api/v1/inventory')
        .send(mockInventoryItem);

      return request(app.getHttpServer())
        .put(`/api/v1/inventory/${createResponse.body.productCode}/stock`)
        .send({ quantity: -10 })
        .expect(400);
    });

    it('should return 404 for non-existent product', () => {
      return request(app.getHttpServer())
        .put('/api/v1/inventory/INV-999999999/stock')
        .send({ quantity: 50 })
        .expect(404);
    });
  });
});

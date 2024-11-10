import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { Connection } from 'mongoose';
import { getConnectionToken } from '@nestjs/mongoose';
import { RabbitMQService } from '../src/rabbitmq/rabbitmq.service';

describe('Inventory Service (e2e)', () => {
  let app: INestApplication;
  let mongoConnection: Connection;
  let rabbitMQService: RabbitMQService;

  const mockInventoryItem = {
    productCode: 'TEST-123456789',
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
    rabbitMQService = moduleFixture.get<RabbitMQService>(RabbitMQService);

    await app.init();
  });

  beforeEach(async () => {
    // Clear the database before each test
    await mongoConnection.dropDatabase();
  });

  afterAll(async () => {
    await mongoConnection.close();
    await app.close();
  });

  describe('/api/v1/inventory (POST)', () => {
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

    it('should reject invalid inventory item data', () => {
      return request(app.getHttpServer())
        .post('/api/v1/inventory')
        .send({
          name: 'Invalid Product',
          quantity: -1, // Invalid quantity
          price: -10, // Invalid price
        })
        .expect(400);
    });

    it('should prevent duplicate product codes', async () => {
      // First create an item
      await request(app.getHttpServer())
        .post('/api/v1/inventory')
        .send(mockInventoryItem);

      // Try to create another item with the same product code
      return request(app.getHttpServer())
        .post('/api/v1/inventory')
        .send(mockInventoryItem)
        .expect(409);
    });
  });

  describe('/api/v1/inventory/:productCode (GET)', () => {
    it('should retrieve an existing inventory item', async () => {
      // First create an item
      const createResponse = await request(app.getHttpServer())
        .post('/api/v1/inventory')
        .send(mockInventoryItem);

      const productCode = createResponse.body.productCode;

      // Then try to retrieve it
      return request(app.getHttpServer())
        .get(`/api/v1/inventory/${productCode}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.productCode).toBe(productCode);
          expect(res.body.name).toBe(mockInventoryItem.name);
        });
    });

    it('should return 404 for non-existent product code', () => {
      return request(app.getHttpServer())
        .get('/api/v1/inventory/NONEXISTENT-123')
        .expect(404);
    });
  });

  describe('/api/v1/inventory/:productCode/stock (PUT)', () => {
    it('should update stock quantity', async () => {
      // First create an item
      const createResponse = await request(app.getHttpServer())
        .post('/api/v1/inventory')
        .send(mockInventoryItem);

      const productCode = createResponse.body.productCode;
      const newQuantity = 50;

      return request(app.getHttpServer())
        .put(`/api/v1/inventory/${productCode}/stock`)
        .send({ quantity: newQuantity })
        .expect(200)
        .expect((res) => {
          expect(res.body.quantity).toBe(newQuantity);
          expect(rabbitMQService.publish).toHaveBeenCalled();
        });
    });

    it('should reject negative stock quantities', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/api/v1/inventory')
        .send(mockInventoryItem);

      const productCode = createResponse.body.productCode;

      return request(app.getHttpServer())
        .put(`/api/v1/inventory/${productCode}/stock`)
        .send({ quantity: -10 })
        .expect(400);
    });

    it('should return 404 when updating non-existent product', () => {
      return request(app.getHttpServer())
        .put('/api/v1/inventory/NONEXISTENT-123/stock')
        .send({ quantity: 50 })
        .expect(404);
    });
  });
});

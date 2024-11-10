import { ConfigModule } from '@nestjs/config';

export const TestConfigModule = ConfigModule.forRoot({
  isGlobal: true,
  load: [
    () => ({
      RABBITMQ_URI: 'amqp://localhost:5672',
      MONGODB_URI: 'mongodb://localhost:27017/orders-test',
    }),
  ],
});

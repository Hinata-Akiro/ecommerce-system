# E-commerce System

A scalable e-commerce system built with microservices architecture using NestJS, MongoDB, RabbitMQ, and Elasticsearch.

## Architecture Overview

The system consists of two main microservices:

- **Inventory Service**: Manages product inventory, stock levels, and product information
- **Order Service**: Handles order processing, creation, and management

### Technology Stack

- **Framework**: NestJS (TypeScript)
- **Database**: MongoDB
- **Message Broker**: RabbitMQ
- **Search & Logging**: Elasticsearch
- **Containerization**: Docker
- **API Documentation**: Swagger/OpenAPI

## Prerequisites

- Docker and Docker Compose
- Node.js 18+
- Yarn package manager

## Getting Started

1. Clone the repository:
   ```bash
   git clone https://github.com/Hinata-Akiro/ecommerce-system.git

   cd ecommerce-system
   ```

2. Environment Setup:
   Create `.env` files in both service directories if you need to override default configurations.

3. Build and run using Docker Compose:
   ```bash
   docker-compose up --build
   ```

This will start:
- Inventory Service (Port 3000)
- Order Service (Port 3002)
- MongoDB (Port 27017)
- RabbitMQ (Ports 5672, 15672)
- Elasticsearch (Port 9200)

## Service Endpoints

### Inventory Service
- API Documentation: `http://localhost:3000/api/docs`
- Base URL: `http://localhost:3000/api/v1`

### Order Service
- API Documentation: `http://localhost:3002/api/docs`
- Base URL: `http://localhost:3002/api/v1`

## Development

### Running Services Individually

#### Inventory Service
```bash
cd inventory-service
yarn install
yarn start:dev
```

#### Order Service
```bash
cd order-service
yarn install
yarn start:dev
```

### Testing

Each service includes unit tests and e2e tests:

```bash
# Unit tests
yarn test

# Integration tests
yarn test:integration

# E2E tests
yarn test:e2e

# Test coverage
yarn test:cov
```

## Design Patterns & Architecture Decisions

1. **Domain-Driven Design (DDD)**
   - Clear separation of domains (Inventory and Orders)
   - Rich domain models with encapsulated business logic
   - Use of repositories for data access abstraction

2. **Event-Driven Architecture**
   - RabbitMQ for asynchronous communication between services
   - Event publishing for stock updates and order status changes
   - Decoupled service communication

3. **Repository Pattern**
   - Abstraction of data persistence logic
   - Clean separation between business logic and data access
   - Example: `InventoryRepository` and `OrderRepository`

4. **CQRS (Command Query Responsibility Segregation)**
   - Separate models for read and write operations
   - Different paths for commands (updates) and queries (reads)

5. **Dependency Injection**
   - NestJS's built-in DI container
   - Loose coupling between components
   - Easier unit testing and maintenance

6. **Circuit Breaker Pattern**
   - Handling service communication failures gracefully
   - Preventing cascade failures in the microservices architecture

## Monitoring & Logging

- **Elasticsearch**: Centralized logging system
- **RabbitMQ Management Console**: `http://localhost:15672`
  - Default credentials: guest/guest

## Docker Configuration

The system uses Docker Compose for orchestration with the following services:

1. **RabbitMQ**
   - Management UI on port 15672
   - AMQP on port 5672
   - Persistent volume for message storage

2. **MongoDB**
   - Separate databases for each service
   - Persistent volume for data storage

3. **Elasticsearch**
   - Single node setup for development
   - Used for logging and monitoring

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.
```




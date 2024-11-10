export interface StockEvent {
  eventType: string;
  productCode: string;
  previousQuantity: number;
  newQuantity: number;
  timestamp: Date;
}

export enum RabbitMQQueues {
  STOCK_CHECK = 'stock.check.requests',
  STOCK_DEDUCT = 'stock.deduct.requests',
  ORDER_STOCK_DEDUCT = 'ORDER_STOCK_DEDUCT',
  ORDER_STOCK_CHECK = 'ORDER_STOCK_CHECK',
}

export enum RabbitMQExchanges {
  INVENTORY = 'inventory.exchange',
}

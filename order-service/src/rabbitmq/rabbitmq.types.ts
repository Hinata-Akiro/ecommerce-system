export enum InventoryEventType {
  STOCK_ADDED = 'STOCK_ADDED',
  STOCK_REDUCED = 'STOCK_REDUCED',
  STOCK_UPDATED = 'STOCK_UPDATED',
}

export enum RabbitMQQueues {
  ORDER_STOCK_CHECK = 'order.stock.check',
  ORDER_STOCK_DEDUCT = 'order.stock.deduct',
  INVENTORY_UPDATES = 'inventory.updates',
}

export enum RabbitMQExchanges {
  INVENTORY = 'inventory.exchange',
  ORDER = 'order.exchange',
}

export interface StockCheckRequest {
  orderId: string;
  items: Array<{
    productCode: string;
    quantity: number;
  }>;
}

export interface StockUpdateEvent {
  eventType: InventoryEventType;
  productCode: string;
  previousQuantity: number;
  newQuantity: number;
  timestamp: Date;
  productName?: string;
}

export interface StockCheckResponse {
  orderId: string;
  success: boolean;
  message?: string;
  availableStock?: {
    [productCode: string]: number;
  };
}

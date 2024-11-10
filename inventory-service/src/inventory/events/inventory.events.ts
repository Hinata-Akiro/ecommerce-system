export enum InventoryEventType {
  STOCK_ADDED = 'STOCK_ADDED',
  STOCK_REDUCED = 'STOCK_REDUCED',
  STOCK_UPDATED = 'STOCK_UPDATED',
}

export interface StockUpdateEvent {
  eventType: InventoryEventType;
  productCode: string;
  previousQuantity: number;
  newQuantity: number;
  timestamp: Date;
  productName?: string;
}

export interface OrderStockCheckRequest {
  correlationId: string;
  productCode: string;
  quantity: number;
  timestamp: Date;
}

export interface OrderStockDeductRequest {
  correlationId: string;
  productCode: string;
  quantity: number;
  timestamp: Date;
}

export interface StockCheckResponse {
  correlationId: string;
  available: boolean;
  currentStock: number;
  timestamp: Date;
}

export interface StockDeductResponse {
  correlationId: string;
  success: boolean;
  newQuantity: number;
  timestamp: Date;
}

import { Document } from 'mongoose';
import { OrderStatus } from '../enums/order.enums';

export interface IOrder extends Document {
  status: OrderStatus;
  productCode: string;
  quantity: number;
  totalPrice: number;
}

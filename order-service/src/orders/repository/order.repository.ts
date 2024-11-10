import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Order } from '../schemas/order.schema';
import { CreateOrderDto } from '../dtos/create-order.dto';
import { OrderStatus } from '../enums/order.enums';

@Injectable()
export class OrderRepository {
  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<Order>,
  ) {}

  async createOrder(
    createOrderDto: CreateOrderDto,
    status: OrderStatus,
  ): Promise<Order> {
    const newOrder = new this.orderModel({
      ...createOrderDto,
      status,
    });
    return await newOrder.save();
  }

  async findOrderById(orderId: string): Promise<Order | null> {
    return await this.orderModel.findById(orderId);
  }

  async updateOrderStatus(
    orderId: string,
    status: OrderStatus,
  ): Promise<Order | null> {
    return await this.orderModel.findByIdAndUpdate(
      orderId,
      { $set: { status } },
      { new: true },
    );
  }
}

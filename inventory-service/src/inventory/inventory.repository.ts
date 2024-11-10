// src/inventory/repository/inventory.repository.ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Inventory } from './schemas/inventory.schema';
import { CreateInventoryDto } from './dtos/create-inventory.dto';

@Injectable()
export class InventoryRepository {
  constructor(
    @InjectModel(Inventory.name)
    private readonly inventoryModel: Model<Inventory>,
  ) {}

  async createItem(createItemDto: CreateInventoryDto): Promise<Inventory> {
    const newItem = new this.inventoryModel(createItemDto);
    return newItem.save();
  }

  async updateStock(
    productCode: string,
    quantity: number,
  ): Promise<Inventory | null> {
    return this.inventoryModel.findOneAndUpdate(
      { productCode },
      { quantity },
      { new: true },
    );
  }

  async findItemById(productCode: string): Promise<Inventory | null> {
    return this.inventoryModel.findOne({ productCode });
  }
}

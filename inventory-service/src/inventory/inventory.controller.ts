import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { InventoryService } from './inventory.service';
import { CreateInventoryDto } from './dtos/create-inventory.dto';
import { UpdateStockDto } from './dtos/update-stock.dto';

@ApiTags('inventory')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new inventory item' })
  @ApiResponse({ status: 201, description: 'Item successfully created' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async createItem(@Body(ValidationPipe) createDto: CreateInventoryDto) {
    return await this.inventoryService.createItem(createDto);
  }

  @Put(':productCode/stock')
  @ApiOperation({ summary: 'Update stock quantity' })
  @ApiResponse({ status: 200, description: 'Stock successfully updated' })
  @ApiResponse({ status: 404, description: 'Item not found' })
  async updateStock(
    @Param('productCode') productCode: string,
    @Body() updateStockDto: UpdateStockDto,
  ) {
    return await this.inventoryService.updateStock(
      productCode,
      updateStockDto.quantity,
    );
  }

  @Get(':productCode')
  @ApiOperation({ summary: 'Get an inventory item by product code' })
  @ApiResponse({ status: 200, description: 'Item found' })
  @ApiResponse({ status: 404, description: 'Item not found' })
  async getItem(@Param('productCode') productCode: string) {
    return await this.inventoryService.getItem(productCode);
  }
}

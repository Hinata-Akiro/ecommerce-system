import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsPositive } from 'class-validator';

export class UpdateStockDto {
  @ApiProperty({
    description: 'New quantity to set for the inventory item',
    minimum: 1,
    example: 10,
    type: Number,
  })
  @IsNumber()
  @IsPositive()
  quantity: number;
}

import { IsString, IsNumber, IsPositive } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateOrderDto {
  @ApiProperty({
    description: 'The product code',
    example: 'PROD-123',
  })
  @IsString()
  productCode: string;

  @ApiProperty({
    description: 'The quantity of the product',
    minimum: 1,
    example: 1,
  })
  @IsNumber()
  @IsPositive()
  quantity: number;

  totalPrice?: number;
}

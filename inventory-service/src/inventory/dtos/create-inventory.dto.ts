import {
  IsString,
  IsNumber,
  IsPositive,
  MinLength,
  IsOptional,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateInventoryDto {
  @ApiPropertyOptional({
    description: 'Unique product code (auto-generated if not provided)',
    minimum: 3,
    required: false,
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  productCode?: string;

  @ApiProperty({ description: 'Name of the product', minimum: 3 })
  @IsString()
  @MinLength(3)
  name: string;

  @ApiProperty({ description: 'Product description' })
  @IsString()
  description: string;

  @ApiProperty({ description: 'Product quantity', minimum: 1 })
  @IsNumber()
  @IsPositive()
  quantity: number;

  @ApiProperty({ description: 'Product price', minimum: 0.01 })
  @IsNumber()
  @IsPositive()
  price: number;
}

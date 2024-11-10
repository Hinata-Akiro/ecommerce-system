export interface IInventory {
  readonly _id?: string;
  productCode: string;
  name: string;
  description?: string;
  quantity: number;
  price: number;
}

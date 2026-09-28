export const TASK_QUEUE = 'orders';

export interface OrderInput {
  orderId: string;
  customerEmail: string;
  sku: string;
  quantity: number;
  amount: number;          // in dollars
}

export type OrderStatus =
  | 'RECEIVED' | 'AWAITING_APPROVAL' | 'RESERVED' | 'CHARGED'
  | 'SHIPPED' | 'CANCELLED' | 'FAILED';

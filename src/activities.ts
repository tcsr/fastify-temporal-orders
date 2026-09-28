import { activityInfo, ApplicationFailure, log } from '@temporalio/activity';

// Fake inventory for the demo (per worker process)
const stock = new Map<string, number>([['BOOK', 10], ['LAPTOP', 2]]);

export async function reserveInventory(orderId: string, sku: string, qty: number) {
  const available = stock.get(sku) ?? 0;
  if (available < qty) {
    throw ApplicationFailure.nonRetryable(`Out of stock: ${sku}`, 'OutOfStock');
  }
  stock.set(sku, available - qty);
  log.info('Inventory reserved', { orderId, sku, qty, left: available - qty });
}

export async function releaseInventory(orderId: string, sku: string, qty: number) {
  stock.set(sku, (stock.get(sku) ?? 0) + qty);
  log.info('Inventory released', { orderId, sku, qty });
}

export async function chargePayment(orderId: string, amount: number): Promise<string> {
  const { attempt } = activityInfo();
  if (attempt < 3) {                       // simulate a flaky gateway
    log.warn('Payment gateway timeout (simulated)', { orderId, attempt });
    throw new Error('Payment gateway timeout');
  }
  log.info('Payment charged', { orderId, amount, attempt });
  return `txn-${orderId}`;
}

export async function refundPayment(txnId: string) {
  log.info('Payment refunded', { txnId });
}

export async function shipOrder(orderId: string): Promise<string> {
  return `TRACK-${orderId.toUpperCase()}`;
}

export async function sendEmail(to: string, message: string) {
  log.info('EMAIL', { to, message });
}

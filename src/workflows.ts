import {
  proxyActivities, defineSignal, defineQuery, setHandler, condition, log,
  ApplicationFailure, CancellationScope,
} from '@temporalio/workflow';
import type * as activities from './activities';
import type { OrderInput, OrderStatus } from './shared';

const {
  reserveInventory, releaseInventory, chargePayment, refundPayment, shipOrder, sendEmail,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 seconds',
  retry: { initialInterval: '1 second', backoffCoefficient: 2, maximumAttempts: 5 },
});

export const approveOrder = defineSignal<[string]>('approveOrder');
export const cancelOrder  = defineSignal('cancelOrder');
export const getStatus    = defineQuery<OrderStatus>('getStatus');

const APPROVAL_LIMIT = 1000;

export async function orderWorkflow(input: OrderInput): Promise<string> {
  let status: OrderStatus = 'RECEIVED';
  let approvedBy: string | undefined;
  let cancelled = false;

  setHandler(approveOrder, (user) => { approvedBy = user; });
  setHandler(cancelOrder, () => { cancelled = true; });
  setHandler(getStatus, () => status);

  // 1. Large orders need a human
  if (input.amount > APPROVAL_LIMIT) {
    status = 'AWAITING_APPROVAL';
    const decided = await condition(() => approvedBy !== undefined || cancelled,
                                    '2 minutes');
    if (!decided || cancelled) {
      status = 'CANCELLED';
      await sendEmail(input.customerEmail, `Order ${input.orderId} was not approved`);
      return 'CANCELLED';
    }
    log.info('Order approved', { approvedBy });
  }

  // 2. Saga: each step registers its undo
  const compensations: Array<() => Promise<void>> = [];
  const checkCancelled = () => {
    if (cancelled) throw ApplicationFailure.nonRetryable('Cancelled by customer');
  };

  try {
    await reserveInventory(input.orderId, input.sku, input.quantity);
    status = 'RESERVED';
    compensations.unshift(() => releaseInventory(input.orderId, input.sku,
                                                 input.quantity));
    checkCancelled();

    const txnId = await chargePayment(input.orderId, input.amount);
    status = 'CHARGED';
    compensations.unshift(() => refundPayment(txnId));
    checkCancelled();

    const tracking = await shipOrder(input.orderId);
    status = 'SHIPPED';
    await sendEmail(input.customerEmail, `Order ${input.orderId} shipped: ${tracking}`);
    return tracking;
  } catch (err) {
    status = cancelled ? 'CANCELLED' : 'FAILED';
    await CancellationScope.nonCancellable(async () => {
      for (const undo of compensations) await undo();
      await sendEmail(input.customerEmail,
                      `Order ${input.orderId} ${status.toLowerCase()}`);
    });
    if (cancelled) return 'CANCELLED';
    throw err;
  }
}

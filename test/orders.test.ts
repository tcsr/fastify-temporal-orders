// End-to-end: HTTP (inject) -> Fastify -> Temporal client -> workflow
//             -> mocked activities, on a time-skipping test server
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { ApplicationFailure } from '@temporalio/common';
import { buildApp } from '../src/app';
import { TASK_QUEUE } from '../src/shared';

let env: TestWorkflowEnvironment;
let app: Awaited<ReturnType<typeof buildApp>>;
let worker: Worker;
let workerRun: Promise<void>;

const activities = {
  reserveInventory: async (_id: string, sku: string) => {
    if (sku === 'NONE') {
      throw ApplicationFailure.nonRetryable('Out of stock: NONE', 'OutOfStock');
    }
  },
  releaseInventory: async () => {},
  chargePayment: async (id: string) => `txn-${id}`,
  refundPayment: async () => {},
  shipOrder: async (id: string) => `TRACK-${id}`,
  sendEmail: async () => {},
};

before(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
  worker = await Worker.create({
    connection: env.nativeConnection, taskQueue: TASK_QUEUE,
    workflowsPath: require.resolve('../src/workflows'), activities,
  });
  workerRun = worker.run();
  app = await buildApp({ temporal: { client: env.client } });   // inject test client
});

after(async () => {
  await app.close();
  worker.shutdown();
  await workerRun;
  await env.teardown();
});

const order = { customerEmail: 'ann@example.com', sku: 'BOOK', quantity: 1,
                amount: 25 };
const post = (payload: object, key?: string) => app.inject({
  method: 'POST', url: '/orders', payload,
  headers: key ? { 'idempotency-key': key } : {},
});

test('rejects an invalid order with 400', async () => {
  const res = await post({ ...order, quantity: 0 });
  assert.equal(res.statusCode, 400);
});

test('small order: 202 + Location, then result', async () => {
  const res = await post(order);
  assert.equal(res.statusCode, 202);
  const { workflowId, statusUrl } = res.json();
  assert.equal(res.headers.location, statusUrl);

  const result = await app.inject(`${statusUrl}/result?waitSeconds=10`);
  assert.equal(result.statusCode, 200);
  assert.match(result.json().result, /^TRACK-/);
  assert.equal((await app.inject(statusUrl)).json().status, 'SHIPPED');
  assert.ok(workflowId.startsWith('order-'));
});

test('Idempotency-Key returns the same order, even after it finished', async () => {
  const key = 'checkout-12345';
  const runId = async (id: string) =>
    (await env.client.workflow.getHandle(id).describe()).runId;

  const a = (await post(order, key)).json();
  const firstRun = await runId(a.workflowId);
  const b = (await post(order, key)).json();                        // while running
  assert.equal(b.workflowId, a.workflowId);
  assert.equal(await runId(b.workflowId), firstRun);

  await app.inject(`${a.statusUrl}/result?waitSeconds=10`);         // let it finish
  const c = await post(order, key);                          // after it finished
  assert.equal(c.statusCode, 202);
  assert.equal(await runId(c.json().workflowId), firstRun);         // no second run
});

test('large order waits for approval given over HTTP', async () => {
  const { statusUrl } = (await post({ ...order, amount: 5000 })).json();
  assert.equal((await app.inject(statusUrl)).json().status, 'AWAITING_APPROVAL');

  const pending = await app.inject(`${statusUrl}/result`);           // waitSeconds=0
  assert.equal(pending.statusCode, 202);

  const approve = await app.inject({ method: 'POST', url: `${statusUrl}/approve`,
                                     payload: { approver: 'manager-jo' } });
  assert.equal(approve.statusCode, 202);
  const done = await app.inject(`${statusUrl}/result?waitSeconds=10`);
  assert.equal(done.statusCode, 200);
});

test('failed order maps to 422 with the business reason', async () => {
  const { statusUrl } = (await post({ ...order, sku: 'NONE' })).json();
  const res = await app.inject(`${statusUrl}/result?waitSeconds=10`);
  assert.equal(res.statusCode, 422);
  assert.equal(res.json().message, 'Out of stock: NONE');
});

test('unknown order maps to 404', async () => {
  const res = await app.inject('/orders/order-does-not-exist');
  assert.equal(res.statusCode, 404);
  const sig = await app.inject({ method: 'POST', url: '/orders/order-nope/cancel' });
  assert.equal(sig.statusCode, 404);
});

test('health reports Temporal reachable', async () => {
  const res = await app.inject('/health');
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().temporal, 'reachable');
});

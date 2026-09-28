import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import {
  WorkflowExecutionAlreadyStartedError, isGrpcDeadlineError,
} from '@temporalio/client';
import { randomUUID } from 'node:crypto';
import { orderWorkflow, approveOrder, cancelOrder, getStatus } from '../workflows';
import { TASK_QUEUE } from '../shared';
import {
  CreateOrder, IdempotencyHeaders, OrderParams, Accepted, OrderView, Approve,
  ResultQuery, ResultReply, ErrorReply,
} from '../schemas/order';

const orders: FastifyPluginAsyncTypebox = async (app) => {
  const common = { tags: ['orders'] };

  // Reads the workflow's own view of the order; never hangs without a worker
  async function view(workflowId: string) {
    const handle = app.temporal.workflow.getHandle(workflowId);
    const desc = await handle.describe();
    const status = await app.temporal.connection
      .withDeadline(Date.now() + 5_000, () => handle.query(getStatus))
      .catch(() => 'UNKNOWN (no worker available)');
    return { workflowId, status, execution: desc.status.name };
  }

  app.post('/', {
    schema: { ...common, body: CreateOrder, headers: IdempotencyHeaders,
              response: { 202: Accepted, 400: ErrorReply } },
  }, async (request, reply) => {
    const key = request.headers['idempotency-key'] ?? randomUUID();
    const workflowId = `order-${key}`;
    try {
      // Bounded: fail fast (503) instead of letting the client retry for ~20 s
      await app.temporal.connection.withDeadline(Date.now() + 5_000, () =>
        app.temporal.workflow.start(orderWorkflow, {
          taskQueue: TASK_QUEUE,
          workflowId,
          args: [{ orderId: key, ...request.body }],
          workflowIdConflictPolicy: 'USE_EXISTING',   // same key while running
          workflowIdReusePolicy: 'REJECT_DUPLICATE',  // same key after it finished
        }));
    } catch (err) {
      if (!(err instanceof WorkflowExecutionAlreadyStartedError)) throw err;
      request.log.info({ workflowId }, 'idempotent replay of a finished order');
    }
    const statusUrl = `/orders/${workflowId}`;
    reply.code(202).header('location', statusUrl);
    return { workflowId, statusUrl };
  });

  app.get('/:id', {
    schema: { ...common, params: OrderParams,
              response: { 200: OrderView, 404: ErrorReply } },
  }, async (request) => view(request.params.id));

  app.post('/:id/approve', {
    schema: { ...common, params: OrderParams, body: Approve,
              response: { 202: Accepted, 404: ErrorReply } },
  }, async (request, reply) => {
    const { id } = request.params;
    const handle = app.temporal.workflow.getHandle(id);
    await handle.signal(approveOrder, request.body.approver);
    reply.code(202);
    return { workflowId: id, statusUrl: `/orders/${id}` };
  });

  app.post('/:id/cancel', {
    schema: { ...common, params: OrderParams,
              response: { 202: Accepted, 404: ErrorReply } },
  }, async (request, reply) => {
    const { id } = request.params;
    await app.temporal.workflow.getHandle(id).signal(cancelOrder);
    reply.code(202);
    return { workflowId: id, statusUrl: `/orders/${id}` };
  });

  app.get('/:id/result', {
    schema: { ...common, params: OrderParams, querystring: ResultQuery,
              response: { 200: ResultReply, 202: OrderView, 404: ErrorReply,
                          422: ErrorReply } },
  }, async (request, reply) => {
    const { id } = request.params;
    const handle = app.temporal.workflow.getHandle(id);
    const running = (await handle.describe()).status.name === 'RUNNING';
    if (running && request.query.waitSeconds === 0) {
      return reply.code(202).send(await view(id));
    }
    try {
      const result = running
        ? await app.temporal.connection.withDeadline(
            Date.now() + request.query.waitSeconds * 1000, () => handle.result())
        : await handle.result();
      return { workflowId: id, result };
    } catch (err) {
      if (!isGrpcDeadlineError(err)) throw err;            // walks the cause chain
      return reply.code(202).send(await view(id));     // still running: poll again
    }
  });
};

export default orders;

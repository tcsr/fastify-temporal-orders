import { Type, Static } from '@fastify/type-provider-typebox';

export const CreateOrder = Type.Object({
  customerEmail: Type.String({ format: 'email' }),
  sku: Type.String({ minLength: 1 }),
  quantity: Type.Integer({ minimum: 1, maximum: 100 }),
  amount: Type.Number({ exclusiveMinimum: 0 }),
}, { additionalProperties: false });
export type CreateOrder = Static<typeof CreateOrder>;

export const IdempotencyHeaders = Type.Object({
  'idempotency-key': Type.Optional(Type.String({ pattern: '^[A-Za-z0-9_-]{8,64}$' })),
});

export const OrderParams = Type.Object({ id: Type.String({ pattern: '^order-' }) });

export const Accepted = Type.Object({
  workflowId: Type.String(), statusUrl: Type.String(),
});

export const OrderView = Type.Object({
  workflowId: Type.String(),
  status: Type.String(),        // business status from the workflow query
  execution: Type.String(),     // RUNNING | COMPLETED | FAILED | ...
});

export const Approve = Type.Object({ approver: Type.String({ minLength: 1 }) },
                                   { additionalProperties: false });

export const ResultQuery = Type.Object({
  waitSeconds: Type.Integer({ minimum: 0, maximum: 30, default: 0 }),
});

export const ResultReply = Type.Object({
  workflowId: Type.String(), result: Type.String(),
});

export const ErrorReply = Type.Object({
  statusCode: Type.Integer(), error: Type.String(), message: Type.String(),
});

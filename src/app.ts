import Fastify, { FastifyServerOptions, FastifyError } from 'fastify';
import { STATUS_CODES } from 'node:http';
import sensible from '@fastify/sensible';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import {
  WorkflowNotFoundError, WorkflowFailedError, isGrpcServiceError, isGrpcDeadlineError,
} from '@temporalio/client';
import temporal, { TemporalPluginOptions } from './plugins/temporal';
import health from './routes/health';
import orders from './routes/orders';

const GRPC_UNAVAILABLE = 14;

// Temporal Service unreachable or too slow: the caller should retry later
function temporalUnavailable(err: unknown): boolean {
  if (isGrpcDeadlineError(err)) return true;
  for (let e: unknown = err; e instanceof Error; e = e.cause) {
    if (isGrpcServiceError(e) && e.code === GRPC_UNAVAILABLE) return true;
  }
  return false;
}

export interface AppOptions extends FastifyServerOptions {
  temporal?: TemporalPluginOptions;
}

export async function buildApp(
  { temporal: temporalOpts = {}, ...opts }: AppOptions = {},
) {
  const app = Fastify(opts).withTypeProvider<TypeBoxTypeProvider>();

  await app.register(sensible);
  await app.register(swagger, {
    openapi: { info: { title: 'Orders API (Fastify + Temporal)', version: '1.0.0' } },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
  await app.register(temporal, temporalOpts);

  // Translate Temporal outcomes into HTTP semantics in one place
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof WorkflowNotFoundError) {
      return reply.code(404).send({ statusCode: 404, error: 'Not Found',
                                    message: 'Order not found' });
    }
    if (error instanceof WorkflowFailedError) {
      let cause: Error | undefined = error.cause;      // unwrap ActivityFailure etc.
      while (cause?.cause instanceof Error) cause = cause.cause;
      return reply.code(422).send({ statusCode: 422, error: 'Unprocessable Entity',
                                    message: cause?.message ?? 'Order failed' });
    }
    if (temporalUnavailable(error)) {
      request.log.warn({ err: error }, 'Temporal unavailable');
      return reply.code(503).header('retry-after', '5').send({
        statusCode: 503, error: 'Service Unavailable',
        message: 'Temporarily unavailable, retry with the same Idempotency-Key',
      });
    }
    const status = error.statusCode ?? 500;
    if (status >= 500) request.log.error({ err: error }, 'unhandled error');
    reply.code(status).send({
      statusCode: status,
      error: STATUS_CODES[status] ?? 'Error',
      message: status >= 500 ? 'Something went wrong' : error.message,
    });
  });

  await app.register(health);
  await app.register(orders, { prefix: '/orders' });
  return app;
}

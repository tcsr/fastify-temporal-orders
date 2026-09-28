import type { FastifyPluginAsync } from 'fastify';

const health: FastifyPluginAsync = async (app) => {
  app.get('/health', { schema: { tags: ['system'] } }, async (request, reply) => {
    try {
      await app.temporal.connection.withDeadline(Date.now() + 2_000,
        () => app.temporal.workflowService.getSystemInfo({}));
      return { status: 'ok', temporal: 'reachable' };
    } catch (err) {
      request.log.warn({ err }, 'Temporal health check failed');
      return reply.code(503).send({ status: 'degraded', temporal: 'unreachable' });
    }
  });
};

export default health;

import fp from 'fastify-plugin';
import { Connection, Client } from '@temporalio/client';

declare module 'fastify' {
  interface FastifyInstance { temporal: Client }
}

export interface TemporalPluginOptions {
  client?: Client;          // pass a ready client (tests, shared connections)
  address?: string;
  namespace?: string;
}

export default fp<TemporalPluginOptions>(async (app, opts) => {
  if (opts.client) {
    app.decorate('temporal', opts.client);   // caller owns the connection
    return;
  }
  const address = opts.address ?? 'localhost:7233';
  const connection = await Connection.connect({ address });
  const namespace = opts.namespace ?? 'default';
  app.decorate('temporal', new Client({ connection, namespace }));
  app.addHook('onClose', async () => { await connection.close(); });
  app.log.info({ address, namespace }, 'connected to Temporal');
}, { name: 'temporal' });

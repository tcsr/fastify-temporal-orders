import closeWithGrace from 'close-with-grace';
import { buildApp } from './app';

async function main() {
  const app = await buildApp({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      transport: process.env.NODE_ENV === 'production'
        ? undefined : { target: 'pino-pretty' },
    },
    temporal: {
      address: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
      namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
    },
  });

  closeWithGrace({ delay: 10_000 }, async ({ signal, err }) => {
    if (err) app.log.error({ err }, 'shutting down after error');
    else app.log.info({ signal }, 'shutting down');
    await app.close();              // stops HTTP, then closes the Temporal connection
  });

  await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' });
}

main().catch((err) => { console.error(err); process.exit(1); });

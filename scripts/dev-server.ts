// Starts a local Temporal dev server (same as `temporal server start-dev`) without
// installing the CLI: @temporalio/testing downloads the official binary on first use.
import { TestWorkflowEnvironment } from '@temporalio/testing';

async function main() {
  const env = await TestWorkflowEnvironment.createLocal({
    server: { ip: '127.0.0.1', port: 7233, ui: true, uiPort: 8233 },
  });
  console.log('Temporal dev server on localhost:7233, UI on http://localhost:8233');
  const stop = async () => { await env.teardown(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  setInterval(() => {}, 1 << 30);   // keep process alive
}
main().catch((err) => { console.error(err); process.exit(1); });

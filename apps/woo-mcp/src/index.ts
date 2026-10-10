import { loadConfig } from './config.js';
import { createServer } from './server.js';

async function main() {
  const config = loadConfig();
  const { start, close } = createServer(config);

  const shutdown = async () => {
    try {
      await close();
      process.exit(0);
    } catch {
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  await start();
  process.stdout.write(`woo-mcp running on http://${config.HOST}:${config.PORT}/mcp\n`);
}

main().catch((err: Error) => {
  process.stderr.write(`Failed to start woo-mcp: ${err.message}\n`);
  process.exit(1);
});

import { createUtilsServer } from './server.js';

async function main() {
  const port = parseInt(process.env.PORT || '3300', 10);
  const host = process.env.HOST || '0.0.0.0';
  const bearerToken = process.env.UTILS_MCP_BEARER_TOKEN;

  const { start, close } = createUtilsServer(port, host, bearerToken);

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
  process.stdout.write(`demo-utils-mcp running on http://${host}:${port}/mcp\n`);
}

main().catch((err: Error) => {
  process.stderr.write(`Failed to start demo-utils-mcp: ${err.message}\n`);
  process.exit(1);
});

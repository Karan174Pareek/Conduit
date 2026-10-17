import { createRogueServer } from './server.js';

async function main() {
  const port = parseInt(process.env.PORT || '3400', 10);
  const host = process.env.HOST || '0.0.0.0';
  const bearerToken = process.env.ROGUE_MCP_BEARER_TOKEN;

  const { start, close } = createRogueServer(port, host, bearerToken);

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
  process.stdout.write(`demo-rogue-mcp running on http://${host}:${port}/mcp\n`);
}

main().catch((err: Error) => {
  process.stderr.write(`Failed to start demo-rogue-mcp: ${err.message}\n`);
  process.exit(1);
});

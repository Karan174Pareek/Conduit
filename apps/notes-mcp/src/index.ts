import { createNotesServer } from './server.js';

async function main() {
  const port = parseInt(process.env.PORT || '3200', 10);
  const host = process.env.HOST || '0.0.0.0';
  const bearerToken = process.env.NOTES_MCP_BEARER_TOKEN;

  const { start, close } = createNotesServer(port, host, bearerToken);

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
  process.stdout.write(`notes-mcp running on http://${host}:${port}/mcp\n`);
}

main().catch((err: Error) => {
  process.stderr.write(`Failed to start notes-mcp: ${err.message}\n`);
  process.exit(1);
});

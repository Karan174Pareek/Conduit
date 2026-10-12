import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { connectToDatabase, closeDatabase } from './db/client.js';
import { runMigrations } from './db/migrations/runner.js';
import { bootstrapAdmin } from './services/bootstrap.js';
import { buildApp } from './app.js';

async function main() {
  const config = loadConfig();
  logger.info('Configuration loaded successfully');

  const { db } = await connectToDatabase(config.MONGO_URI);

  // Run forward-only migrations under distributed Mongo lock
  await runMigrations(db);

  // Bootstrap initial admin if no admin exists
  await bootstrapAdmin(db, config);

  const app = buildApp(config, db);

  // Graceful shutdown handling
  let isShuttingDown = false;
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info({ signal }, 'Graceful shutdown initiated');

    try {
      await app.close();
      logger.info('Fastify server closed');
      await closeDatabase();
      logger.info('Database connections closed');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during graceful shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  try {
    const address = await app.listen({ port: config.PORT, host: config.HOST });
    logger.info({ address }, 'Conduit Gateway running and ready to accept connections');
  } catch (err) {
    logger.fatal({ err }, 'Failed to start Conduit Gateway server');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal initialization error:', err);
  process.exit(1);
});

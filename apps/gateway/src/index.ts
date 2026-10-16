import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { connectToDatabase, closeDatabase } from './db/client.js';
import { runMigrations } from './db/migrations/runner.js';
import { bootstrapAdmin } from './services/bootstrap.js';
import { seedDefaultServers } from './registry/seed.js';
import { buildApp } from './app.js';
import { startMetricsServer } from './metrics.js';
import type { UpstreamManager } from './upstream/manager.js';
import type { CredentialCrypto } from './registry/crypto.js';
import type { SystemStateDocument } from './db/types.js';

async function main() {
  const config = loadConfig();
  logger.info('Configuration loaded successfully');

  const { db } = await connectToDatabase(config.MONGO_URI);

  // 1. Run forward-only migrations under distributed Mongo lock
  await runMigrations(db);

  // 2. Bootstrap initial admin if no admin exists
  await bootstrapAdmin(db, config);

  let isShuttingDown = false;
  const app = buildApp(config, db, { isReady: () => !isShuttingDown });

  const upstreamManager = (app as any).upstreamManager as UpstreamManager;
  const crypto = (app as any).crypto as CredentialCrypto;

  // 3. Seed default first-party servers (idempotent upsert)
  await seedDefaultServers(
    db,
    crypto,
    {
      wooMcpUrl: config.WOO_MCP_URL,
      wooMcpBearerToken: config.WOO_MCP_BEARER_TOKEN,
    },
    app.log,
  );

  // 4. Initial load of servers into in-memory UpstreamManager
  await upstreamManager.loadServers();

  // 5. Start background health checks and catalog refresh
  upstreamManager.startBackgroundLoops();

  // 6. Config convergence polling loop (every 5 seconds)
  let lastKnownConfigVersion = 0;
  const initialConfigDoc = await db.collection<SystemStateDocument>('system_state').findOne({ _id: 'config' });
  if (initialConfigDoc?.configVersion) {
    lastKnownConfigVersion = initialConfigDoc.configVersion;
  }

  const configConvergenceTimer = setInterval(async () => {
    try {
      const doc = await db.collection<SystemStateDocument>('system_state').findOne({ _id: 'config' });
      if (doc?.configVersion && doc.configVersion !== lastKnownConfigVersion) {
        lastKnownConfigVersion = doc.configVersion;
        app.log.info({ configVersion: lastKnownConfigVersion }, 'Detected configVersion change; reloading upstream servers');
        await upstreamManager.loadServers();
      }
    } catch (err) {
      app.log.debug({ err }, 'Error checking configVersion convergence');
    }
  }, 5000);

  // 7. Start Prometheus metrics server on dedicated internal port (not reachable via Ingress)
  let metricsHandle: { close: () => Promise<void> } | null = null;
  try {
    metricsHandle = await startMetricsServer(
      config.METRICS_PORT,
      config.HOST,
      () => upstreamManager,
      () => (app as any).auditSink,
      app.log,
    );
  } catch (err) {
    app.log.error({ err }, 'Failed to start Prometheus metrics server');
  }

  // Graceful shutdown handling
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info({ signal }, 'Graceful shutdown initiated; failing /readyz immediately');

    clearInterval(configConvergenceTimer);
    upstreamManager.stopBackgroundLoops();

    if (metricsHandle) {
      try {
        await metricsHandle.close();
        logger.info('Prometheus metrics server closed');
      } catch (err) {
        logger.warn({ err }, 'Error closing metrics server');
      }
    }

    try {
      await app.close();
      logger.info('Fastify server closed (in-flight drained)');

      const auditSink = (app as any).auditSink;
      if (auditSink) {
        await auditSink.close();
        logger.info('MongoAuditSink queue flushed and closed');
      }

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

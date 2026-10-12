import type { FastifyPluginAsync } from 'fastify';
import type { Db } from 'mongodb';
import { isSchemaReady, getCurrentSchemaVersion } from '../db/migrations/runner.js';

export const healthRoutes = (db: Db): FastifyPluginAsync => async (fastify) => {
  // Liveness probe: event loop only
  fastify.get('/healthz', async (_req, reply) => {
    return reply.status(200).send({ status: 'ok' });
  });

  // Readiness probe: Mongo ping AND schema version ready (ignores upstreams!)
  fastify.get('/readyz', async (_req, reply) => {
    let isMongoAlive = false;
    try {
      await db.command({ ping: 1 });
      isMongoAlive = true;
    } catch {
      isMongoAlive = false;
    }

    if (!isMongoAlive) {
      return reply.status(503).send({
        status: 'unready',
        reason: 'MongoDB connection failed or unresponsive',
      });
    }

    const schemaReady = await isSchemaReady(db);
    if (!schemaReady) {
      const current = await getCurrentSchemaVersion(db);
      return reply.status(503).send({
        status: 'unready',
        reason: `Schema migration pending (current version: ${current})`,
      });
    }

    const currentVersion = await getCurrentSchemaVersion(db);
    return reply.status(200).send({
      status: 'ready',
      schemaVersion: currentVersion,
    });
  });
};

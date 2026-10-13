import type { FastifyPluginAsync } from 'fastify';
import type { Db } from 'mongodb';
import { z } from 'zod';
import type { Config } from '../config.js';
import { createApiKey, listApiKeys, revokeApiKey, MAX_KEYS_PER_USER } from '../services/api-keys.js';
import { requireAuth } from '../middleware/authenticator.js';
import { toObjectId, type ApiKeyDocument, type AdminEventDocument } from '../db/types.js';

const createKeySchema = z.object({
  name: z.string().min(1, 'Key name is required').max(100, 'Key name is too long'),
  expiresAt: z.string().datetime().optional(),
});

export const keysRoutes = (db: Db, config: Config): FastifyPluginAsync => async (fastify) => {
  fastify.addHook('preHandler', requireAuth(db, config));

  // POST /api/keys - Create API Key
  fastify.post('/', async (req, reply) => {
    const parseResult = createKeySchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        code: 'invalid_request',
        message: parseResult.error.issues.map((i) => i.message).join(', '),
        statusCode: 400,
      });
    }

    const { name, expiresAt } = parseResult.data;
    const principal = req.principal!;
    const expDate = expiresAt ? new Date(expiresAt) : null;

    try {
      const createdKey = await createApiKey(
        db,
        config.API_KEY_PEPPER,
        principal.userId,
        name,
        expDate,
      );

      await db.collection<AdminEventDocument>('admin_events').insertOne({
        ts: new Date(),
        actorId: principal.userId,
        actorEmail: (req as any).user?.email ?? principal.userId,
        action: 'key.issue',
        target: { type: 'key', id: createdKey.id, label: name },
        details: { keyId: createdKey.id, name, prefix: createdKey.prefix },
        requestId: req.id,
        ip: req.ip,
      });

      return reply.status(201).send(createdKey);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes(`Maximum of ${MAX_KEYS_PER_USER}`)) {
        return reply.status(400).send({
          code: 'limit_exceeded',
          message: err.message,
          statusCode: 400,
        });
      }
      throw err;
    }
  });

  // GET /api/keys - List API Keys (own for member, all for admin)
  fastify.get('/', async (req, reply) => {
    const principal = req.principal!;
    const isAdmin = principal.role === 'admin';
    const keys = await listApiKeys(db, principal.userId, isAdmin);
    return reply.status(200).send({ keys });
  });

  // DELETE /api/keys/:id - Revoke API Key (own for member, any for admin)
  fastify.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const principal = req.principal!;
    const isAdmin = principal.role === 'admin';

    const objId = toObjectId(id);
    if (!objId) {
      return reply.status(404).send({
        code: 'not_found',
        message: 'API key not found',
        statusCode: 404,
      });
    }

    const keyDoc = await db.collection<ApiKeyDocument>('api_keys').findOne({ _id: objId });

    if (!keyDoc) {
      return reply.status(404).send({
        code: 'not_found',
        message: 'API key not found',
        statusCode: 404,
      });
    }

    if (!isAdmin && keyDoc.ownerId !== principal.userId) {
      return reply.status(403).send({
        code: 'forbidden',
        message: 'Cannot revoke another user’s API key',
        statusCode: 403,
      });
    }

    await revokeApiKey(db, id, principal.userId, isAdmin);

    await db.collection<AdminEventDocument>('admin_events').insertOne({
      ts: new Date(),
      actorId: principal.userId,
      actorEmail: (req as any).user?.email ?? principal.userId,
      action: 'key.revoke',
      target: { type: 'key', id, label: keyDoc.name },
      details: { keyId: id, prefix: keyDoc.prefix },
      requestId: req.id,
      ip: req.ip,
    });

    return reply.status(200).send({ ok: true });
  });
};

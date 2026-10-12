import type { FastifyPluginAsync } from 'fastify';
import type { Db } from 'mongodb';
import type { Config } from '../config.js';
import { requireAuth } from '../middleware/authenticator.js';
import { toObjectId, type UserDocument } from '../db/types.js';

export const debugRoutes = (db: Db, config: Config): FastifyPluginAsync => async (fastify) => {
  // Only register if ENABLE_DEBUG_ROUTES is true
  if (!config.ENABLE_DEBUG_ROUTES) {
    return;
  }

  fastify.get('/whoami', { preHandler: requireAuth(db, config) }, async (req, reply) => {
    const principal = req.principal!;
    const objId = toObjectId(principal.userId);
    const user = objId ? await db.collection<UserDocument>('users').findOne({ _id: objId }) : null;

    return reply.status(200).send({
      principal,
      user: user
        ? {
            id: user._id.toString(),
            email: user.email,
            role: user.role,
          }
        : null,
    });
  });
};

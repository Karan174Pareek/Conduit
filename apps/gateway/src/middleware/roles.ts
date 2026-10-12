import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Db } from 'mongodb';
import type { Role } from '@conduit/shared';
import { toObjectId, type UserDocument } from '../db/types.js';

export function requireRole(expectedRole: Role, db?: Db) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.principal) {
      return reply.status(401).send({
        code: 'unauthorized',
        message: 'Authentication required',
        statusCode: 401,
      });
    }

    if (db) {
      const objId = toObjectId(req.principal.userId);
      if (objId) {
        const user = await db.collection<UserDocument>('users').findOne({ _id: objId });
        if (!user || user.disabled || user.status === 'disabled') {
          return reply.status(401).send({
            code: 'unauthorized',
            message: 'User account is disabled or not found',
            statusCode: 401,
          });
        }
        if (user.role !== expectedRole) {
          return reply.status(403).send({
            code: 'forbidden',
            message: `Forbidden: role '${expectedRole}' required`,
            statusCode: 403,
          });
        }
        req.principal.role = user.role;
        return;
      }
    }

    if (req.principal.role !== expectedRole) {
      return reply.status(403).send({
        code: 'forbidden',
        message: `Forbidden: role '${expectedRole}' required`,
        statusCode: 403,
      });
    }
  };
}

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Role } from '@conduit/shared';

export function requireRole(expectedRole: Role) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.principal) {
      return reply.status(401).send({
        code: 'unauthorized',
        message: 'Authentication required',
        statusCode: 401,
      });
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

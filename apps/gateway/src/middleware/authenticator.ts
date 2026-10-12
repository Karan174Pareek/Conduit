import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Db } from 'mongodb';
import type { Principal, Role } from '@conduit/shared';
import { verifyApiKey } from '../services/api-keys.js';
import { getSessionAndTouch } from '../services/sessions.js';
import type { Config } from '../config.js';
import type { SessionDocument } from '../db/types.js';

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal;
    sessionDoc?: SessionDocument;
  }
}

export async function authenticateRequest(
  req: FastifyRequest,
  db: Db,
  config: Config,
): Promise<Principal | null> {
  // 1. Try Bearer token (API Key)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const rawKey = authHeader.slice(7).trim();
    const result = await verifyApiKey(db, config.API_KEY_PEPPER, rawKey);
    if (!result) {
      return null;
    }

    const { key, user } = result;
    const keyId = key._id ? key._id.toString() : undefined;
    const principal: Principal = {
      userId: user._id.toString(),
      role: user.role as Role,
      via: 'apikey',
      keyId,
      source: 'mcp',
    };
    req.principal = principal;
    return principal;
  }

  // 2. Try Session Cookie
  const sessionId = req.cookies?.['session_id'];
  if (sessionId) {
    const result = await getSessionAndTouch(db, sessionId);
    if (!result) {
      return null;
    }

    const { session, user } = result;
    req.sessionDoc = session;
    const principal: Principal = {
      userId: user._id.toString(),
      role: user.role as Role,
      via: 'session',
      source: 'chat',
    };
    req.principal = principal;
    return principal;
  }

  return null;
}

export function requireAuth(db: Db, config: Config) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const principal = await authenticateRequest(req, db, config);
    if (!principal) {
      return reply.status(401).send({
        code: 'unauthorized',
        message: 'Invalid or missing authentication credentials',
        statusCode: 401,
      });
    }
  };
}

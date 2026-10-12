import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Config } from '../config.js';

export function verifyOrigin(req: FastifyRequest, config: Config): boolean {
  const origin = req.headers.origin || req.headers.referer;
  if (!origin) {
    // If no origin or referer (e.g. server-to-server or non-browser), check if bearer auth or reject browser mutations
    return true;
  }

  const allowedOrigins = config.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
  try {
    const originUrl = new URL(origin).origin;
    return allowedOrigins.some((allowed) => {
      try {
        return new URL(allowed).origin === originUrl;
      } catch {
        return allowed === originUrl;
      }
    });
  } catch {
    return false;
  }
}

export function csrfProtection(config: Config) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    // Only mutating methods need CSRF validation
    const mutatingMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
    if (!mutatingMethods.includes(req.method)) {
      return;
    }

    // Origin check
    if (!verifyOrigin(req, config)) {
      return reply.status(403).send({
        code: 'forbidden',
        message: 'Invalid request origin',
        statusCode: 403,
      });
    }

    // If authenticated via Bearer API Key, browser CSRF doesn't apply
    if (req.principal?.via === 'apikey') {
      return;
    }

    // If authenticated via session, double-submit CSRF token is required
    if (req.principal?.via === 'session') {
      const sentToken = req.headers['x-csrf-token'];
      const sessionToken = req.sessionDoc?.csrfToken;

      if (!sentToken || !sessionToken || sentToken !== sessionToken) {
        return reply.status(403).send({
          code: 'forbidden',
          message: 'Invalid or missing CSRF token',
          statusCode: 403,
        });
      }
    }
  };
}

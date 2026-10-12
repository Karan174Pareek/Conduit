import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import type { Db } from 'mongodb';
import crypto from 'node:crypto';
import type { Config } from './config.js';
import { REDACTED_PATHS } from './logger.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { keysRoutes } from './routes/keys.js';
import { debugRoutes } from './routes/debug.js';
import { csrfProtection } from './middleware/csrf.js';

export function buildApp(config: Config, db: Db): FastifyInstance {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: {
        paths: REDACTED_PATHS,
        censor: '[REDACTED]',
      },
    },
    requestIdHeader: 'x-request-id',
    genReqId: (req) => {
      const existing = req.headers['x-request-id'];
      if (typeof existing === 'string' && existing.trim()) {
        return existing.trim();
      }
      return crypto.randomUUID();
    },
  });

  // Register cookie parser
  app.register(fastifyCookie, {
    secret: config.SESSION_SECRET,
    parseOptions: {},
  });

  // Always echo x-request-id in response headers
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  // Apply CSRF and Origin check on mutating API requests
  app.addHook('preHandler', csrfProtection(config));

  // Health and probe routes
  app.register(healthRoutes(db));

  // Core API routes
  app.register(authRoutes(db, config), { prefix: '/api/auth' });
  app.register(keysRoutes(db, config), { prefix: '/api/keys' });

  // Optional debug routes
  if (config.ENABLE_DEBUG_ROUTES) {
    app.register(debugRoutes(db, config), { prefix: '/api/_debug' });
  }

  // Central error handler
  app.setErrorHandler((error: Error & { statusCode?: number; code?: string }, request, reply) => {
    app.log.error({ err: error, reqId: request.id }, 'Unhandled request error');

    const statusCode = error.statusCode || 500;
    return reply.status(statusCode).send({
      code: error.code || 'internal_error',
      message: statusCode >= 500 ? 'Internal server error' : error.message,
      requestId: request.id,
      statusCode,
    });
  });

  return app;
}

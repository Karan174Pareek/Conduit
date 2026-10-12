import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import type { Db } from 'mongodb';
import crypto from 'node:crypto';
import { type Config, parseEncryptionKeys } from './config.js';
import { REDACTED_PATHS } from './logger.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { keysRoutes } from './routes/keys.js';
import { serverRoutes } from './routes/servers.js';
import { mcpRoutes } from './routes/mcp.js';
import { csrfProtection } from './middleware/csrf.js';
import { CredentialCrypto } from './registry/crypto.js';
import { CatalogService } from './catalog/service.js';
import { UpstreamManager } from './upstream/manager.js';
import { ToolRouter } from './router/tool-router.js';

export interface AppDependencies {
  crypto?: CredentialCrypto;
  catalogService?: CatalogService;
  upstreamManager?: UpstreamManager;
  toolRouter?: ToolRouter;
}

export function buildApp(config: Config, db: Db, deps: AppDependencies = {}): FastifyInstance {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: {
        paths: REDACTED_PATHS,
        censor: '[REDACTED]',
      },
    },
    bodyLimit: 1024 * 1024, // 1 MB request body limit
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

  // Instantiate gateway core components
  const encryptionKeys = parseEncryptionKeys(config.CREDENTIAL_ENC_KEYS);
  const credCrypto = deps.crypto ?? new CredentialCrypto(encryptionKeys);
  const catalogService = deps.catalogService ?? new CatalogService(db, app.log);
  const upstreamManager = deps.upstreamManager ?? new UpstreamManager(db, credCrypto, catalogService, app.log);
  const toolRouter = deps.toolRouter ?? new ToolRouter(db, upstreamManager, undefined, undefined, undefined, app.log);

  // Attach to fastify instance for testing / lifecycle management
  (app as any).upstreamManager = upstreamManager;
  (app as any).toolRouter = toolRouter;
  (app as any).catalogService = catalogService;
  (app as any).crypto = credCrypto;

  // Health and probe routes
  app.register(healthRoutes(db));

  // Core API routes
  app.register(authRoutes(db, config), { prefix: '/api/auth' });
  app.register(keysRoutes(db, config), { prefix: '/api/keys' });
  app.register(serverRoutes, {
    db,
    config,
    crypto: credCrypto,
    catalogService,
    upstreamManager,
    prefix: '/api',
  });

  // MCP front door
  app.register(mcpRoutes, { db, config, toolRouter });

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

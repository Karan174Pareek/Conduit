import Fastify, { type FastifyInstance, type FastifyBaseLogger } from 'fastify';
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
import { auditRoutes } from './routes/audit.js';
import { inviteRoutes } from './routes/invites.js';
import { userRoutes } from './routes/users.js';
import { chatRoutes } from './routes/chat.js';
import { csrfProtection } from './middleware/csrf.js';
import { CredentialCrypto } from './registry/crypto.js';
import { CatalogService } from './catalog/service.js';
import { UpstreamManager } from './upstream/manager.js';
import { ToolRouter } from './router/tool-router.js';
import { MongoAuditSink } from './audit/sink.js';
import { ChatService } from './chat/service.js';
import { GeminiLlmClient } from './chat/gemini-client.js';
import { FakeLlmClient } from './chat/fake-client.js';
import type { LlmClient } from './chat/types.js';
import { policiesRoutes } from './routes/policies.js';
import { DbPolicyEngine } from './policy/engine.js';
import { TokenBucketRateLimiter } from './middleware/rate-limiter.js';

export interface AppDependencies {
  crypto?: CredentialCrypto;
  catalogService?: CatalogService;
  upstreamManager?: UpstreamManager;
  toolRouter?: ToolRouter;
  auditSink?: MongoAuditSink;
  chatService?: ChatService;
  llmClient?: LlmClient;
  isReady?: () => boolean;
  loggerInstance?: FastifyBaseLogger;
}

export function buildApp(config: Config, db: Db, deps: AppDependencies = {}): FastifyInstance {
  const app = Fastify({
    ...(deps.loggerInstance
      ? { loggerInstance: deps.loggerInstance }
      : {
          logger: {
            level: config.LOG_LEVEL,
            redact: {
              paths: REDACTED_PATHS,
              censor: '[REDACTED]',
            },
          },
        }),
    bodyLimit: 1024 * 1024, // 1 MB request body limit
    connectionTimeout: 10000,
    requestIdHeader: 'x-request-id',
    genReqId: (req) => {
      const existing = req.headers['x-request-id'];
      if (typeof existing === 'string' && existing.trim()) {
        return existing.trim();
      }
      return crypto.randomUUID();
    },
  });

  // Enforce underlying HTTP timeouts
  if (app.server) {
    app.server.headersTimeout = 10000;
    app.server.requestTimeout = 30000;
  }

  // Register cookie parser with secure flag in production
  app.register(fastifyCookie, {
    secret: config.SESSION_SECRET,
    parseOptions: {
      secure: config.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
    },
  });

  // Security headers and cache control hook
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.removeHeader('X-Powered-By');

    if (request.url.startsWith('/api')) {
      reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
    }

    const proto = request.headers['x-forwarded-proto'];
    if (proto === 'https' || request.protocol === 'https') {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
  });

  // Apply CSRF and Origin check on mutating API requests
  app.addHook('preHandler', csrfProtection(config));

  // Instantiate gateway core components
  const encryptionKeys = parseEncryptionKeys(config.CREDENTIAL_ENC_KEYS);
  const credCrypto = deps.crypto ?? new CredentialCrypto(encryptionKeys);
  const catalogService = deps.catalogService ?? new CatalogService(db, app.log);
  const upstreamManager = deps.upstreamManager ?? new UpstreamManager(db, credCrypto, catalogService, app.log);
  const auditSink = deps.auditSink ?? new MongoAuditSink(db, app.log);
  const policyEngine = new DbPolicyEngine(db);
  const rateLimiter = new TokenBucketRateLimiter();
  const toolRouter = deps.toolRouter ?? new ToolRouter(db, upstreamManager, policyEngine, rateLimiter, auditSink, app.log);

  // Initialize ChatService
  let chatService = deps.chatService;
  if (!chatService) {
    let llmClient = deps.llmClient;
    if (!llmClient) {
      const isFake = process.env.CONDUIT_CHAT_FAKE_LLM === 'true' || process.env.CHAT_LLM === 'fake';
      if (isFake) {
        if (process.env.NODE_ENV === 'production') {
          throw new Error('Fatal: Fake LLM client (CHAT_LLM=fake) is strictly prohibited in production (NODE_ENV=production)');
        }
        llmClient = new FakeLlmClient();
      } else if (config.GEMINI_API_KEY) {
        llmClient = new GeminiLlmClient(config.GEMINI_API_KEY, config.GEMINI_MODEL);
      }
    }
    if (llmClient) {
      chatService = new ChatService(db, toolRouter, llmClient);
    }
  }

  // Attach to fastify instance for testing / lifecycle management
  (app as any).upstreamManager = upstreamManager;
  (app as any).toolRouter = toolRouter;
  (app as any).catalogService = catalogService;
  (app as any).crypto = credCrypto;
  (app as any).auditSink = auditSink;
  (app as any).chatService = chatService;

  // Health and probe routes
  app.register(healthRoutes(db, deps.isReady));

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
  app.register(auditRoutes, { db, config, prefix: '/api' });
  app.register(inviteRoutes, { db, config, prefix: '/api' });
  app.register(userRoutes, { db, config, prefix: '/api' });
  app.register(chatRoutes, { db, config, chatService, prefix: '/api' });
  app.register(policiesRoutes, { db, config, prefix: '/api/policies' });

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

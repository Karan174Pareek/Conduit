import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance, RouteOptions } from 'fastify';
import { MongoClient, type Db, ObjectId } from 'mongodb';
import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import { CredentialCrypto } from '../src/registry/crypto.js';
import { UpstreamManager } from '../src/upstream/manager.js';
import { CatalogService } from '../src/catalog/service.js';
import { ToolRouter } from '../src/router/tool-router.js';
import { MongoAuditSink } from '../src/audit/sink.js';
import { parseEncryptionKeys } from '../src/config.js';
import { hashPassword } from '../src/services/password.js';
import { createSession } from '../src/services/sessions.js';
import { createApiKey } from '../src/services/api-keys.js';
import type { UserDocument, AdminEventDocument } from '../src/db/types.js';
import { getIsolatedTestDbUri } from './test-db-helper.js';

type RouteClassification = 'public' | 'session' | 'session+admin' | 'mcp-key';

// Complete classification contract for every route in Conduit Gateway
const ROUTE_CLASSIFICATIONS: Record<string, RouteClassification> = {
  'GET /healthz': 'public',
  'GET /readyz': 'public',
  'POST /api/auth/login': 'public',
  'POST /api/auth/accept-invite': 'public',
  'GET /api/config': 'public',
  'POST /api/auth/logout': 'session',
  'POST /api/auth/change-password': 'session',
  'GET /api/auth/me': 'session',
  'GET /api/keys': 'session',
  'POST /api/keys': 'session',
  'DELETE /api/keys/:id': 'session',
  'GET /api/servers': 'session',
  'GET /api/servers/:id/tools': 'session',
  'GET /api/audit': 'session',
  'GET /api/audit/export.csv': 'session',
  'POST /api/chat': 'session',
  'GET /api/conversations': 'session',
  'GET /api/conversations/:id': 'session',
  'DELETE /api/conversations/:id': 'session',
  'GET /api/invites': 'session+admin',
  'POST /api/invites': 'session+admin',
  'DELETE /api/invites/:id': 'session+admin',
  'GET /api/users': 'session+admin',
  'PATCH /api/users/:id': 'session+admin',
  'POST /api/servers': 'session+admin',
  'PATCH /api/servers/:id': 'session+admin',
  'DELETE /api/servers/:id': 'session+admin',
  'POST /api/servers/test': 'session+admin',
  'POST /api/servers/:id/tools/approve': 'session+admin',
  'GET /api/admin-events': 'session+admin',
  'GET /api/stats/servers': 'session+admin',
  'POST /mcp': 'mcp-key',
  'GET /mcp': 'public', // 405 Method Not Allowed
  'DELETE /mcp': 'public', // 405 Method Not Allowed
};

describe('Route Classification, Authentication Matrix & Actor Email Security', () => {
  let mongoClient: MongoClient;
  let db: Db;
  let adminSessionCookie: string;
  let adminCsrf: string;
  let memberSessionCookie: string;
  let memberCsrf: string;
  let validApiKey: string;
  let testApp: FastifyInstance;
  const discoveredRoutes: Array<{ method: string; path: string }> = [];

  const { dbName: testDbName, uri: testMongoUri } = getIsolatedTestDbUri('route_class');

  const testConfig: Config = {
    PORT: 3000,
    HOST: '0.0.0.0',
    MONGO_URI: testMongoUri,
    MONGO_DB_NAME: testDbName,
    SESSION_SECRET: 'test-session-secret-must-be-at-least-32-chars-long!',
    CREDENTIAL_ENC_KEYS: 'k1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    LOG_LEVEL: 'silent',
    DASHBOARD_ORIGIN: 'http://dashboard.localhost',
    ALLOWED_ORIGINS: 'http://dashboard.localhost',
    INVITE_ONLY: true,
    CORS_ALLOWED_ORIGINS: ['http://dashboard.localhost'],
    AUDIT_RETENTION_DAYS: 30,
    MAX_CONCURRENT_PER_UPSTREAM: 8,
    UPSTREAM_CALL_TIMEOUT_MS: 30000,
    COOKIE_SECURE: false,
    API_KEY_PEPPER: 'test-api-key-pepper-must-be-32-chars!',
    ADMIN_INIT_SECRET: 'test-admin-secret-at-least-32-chars-long!',
    SYSTEM_INIT_MODE: false,
    ADMIN_EMAIL: '',
    ADMIN_PASSWORD: '',
    ORG_NAME: 'Test Org',
    GEMINI_API_KEY: '',
    GEMINI_MODEL: 'gemini-2.5-flash',
  };

  beforeAll(async () => {
    mongoClient = new MongoClient(testConfig.MONGO_URI);
    await mongoClient.connect();
    db = mongoClient.db(testConfig.MONGO_DB_NAME);

    // Seed admin user
    const adminPasswordHash = await hashPassword('AdminPass123!');
    const adminUserRes = await db.collection<UserDocument>('users').insertOne({
      _id: new ObjectId(),
      email: 'admin@conduit.localhost',
      name: 'Admin User',
      passwordHash: adminPasswordHash,
      role: 'admin',
      failedLoginAttempts: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const adminSession = await createSession(db, adminUserRes.insertedId.toString());
    adminSessionCookie = `session_id=${adminSession.sessionId}`;
    adminCsrf = adminSession.csrfToken;

    // Seed member user
    const memberPasswordHash = await hashPassword('MemberPass123!');
    const memberUserRes = await db.collection<UserDocument>('users').insertOne({
      _id: new ObjectId(),
      email: 'member@conduit.localhost',
      name: 'Member User',
      passwordHash: memberPasswordHash,
      role: 'member',
      failedLoginAttempts: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const memberSession = await createSession(db, memberUserRes.insertedId.toString());
    memberSessionCookie = `session_id=${memberSession.sessionId}`;
    memberCsrf = memberSession.csrfToken;

    // Build app and register route listener
    const credCrypto = new CredentialCrypto(parseEncryptionKeys(testConfig.CREDENTIAL_ENC_KEYS));
    const catalogService = new CatalogService(db);
    const upstreamManager = new UpstreamManager(db, credCrypto, catalogService);
    const auditSink = new MongoAuditSink(db);
    const toolRouter = new ToolRouter(db, upstreamManager, undefined, undefined, auditSink);

    testApp = buildApp(testConfig, db, {
      crypto: credCrypto,
      catalogService,
      upstreamManager,
      toolRouter,
      auditSink,
    });

    testApp.addHook('onRoute', (routeOptions: RouteOptions) => {
      // Exclude HEAD/OPTIONS and Fastify internals
      const method = routeOptions.method;
      if (typeof method === 'string' && method !== 'HEAD' && method !== 'OPTIONS') {
        discoveredRoutes.push({ method, path: routeOptions.url });
      } else if (Array.isArray(method)) {
        for (const m of method) {
          if (m !== 'HEAD' && m !== 'OPTIONS') {
            discoveredRoutes.push({ method: m, path: routeOptions.url });
          }
        }
      }
    });

    await testApp.ready();

    // Create an API key for the member
    const created = await createApiKey(db, memberUserRes.insertedId.toString(), 'test-api-key');
    validApiKey = created.key;
  }, 30000);

  afterAll(async () => {
    if (testApp) await testApp.close();
    if (db) await db.dropDatabase().catch(() => {});
    if (mongoClient) await mongoClient.close();
  });

  it('fails when any route in Fastify route table is unclassified', () => {
    expect(discoveredRoutes.length).toBeGreaterThan(0);

    for (const r of discoveredRoutes) {
      const key = `${r.method} ${r.path}`;
      const classification = ROUTE_CLASSIFICATIONS[key];
      expect(
        classification,
        `Unclassified route discovered in Fastify route table: "${key}". Every route must be classified in ROUTE_CLASSIFICATIONS!`,
      ).toBeDefined();
    }
  });

  it('enforces authentication and authorization matrix for all classified routes', async () => {
    for (const r of discoveredRoutes) {
      const routeKey = `${r.method} ${r.path}`;
      const classification = ROUTE_CLASSIFICATIONS[routeKey];
      const testUrl = r.path.replace(':id', new ObjectId().toString());

      // 1. Unauthenticated test (non-public routes must return 401)
      if (classification === 'session' || classification === 'session+admin') {
        const unauthRes = await testApp.inject({
          method: r.method,
          url: testUrl,
        });
        expect(
          unauthRes.statusCode,
          `Expected 401 for unauthenticated call to "${routeKey}", got ${unauthRes.statusCode}`,
        ).toBe(401);
      }

      // 2. API Key rejection on protected /api/* routes (must return 401: API keys work ONLY on POST /mcp)
      if (classification === 'session' || classification === 'session+admin') {
        const apiKeyRes = await testApp.inject({
          method: r.method,
          url: testUrl,
          headers: {
            authorization: `Bearer ${validApiKey}`,
          },
        });
        expect(
          apiKeyRes.statusCode,
          `Expected 401 for API key presented to "${routeKey}" (API keys must work ONLY on POST /mcp), got ${apiKeyRes.statusCode}`,
        ).toBe(401);
      }

      // 3. Member role rejection on session+admin routes (must return 403)
      if (classification === 'session+admin') {
        const memberRes = await testApp.inject({
          method: r.method,
          url: testUrl,
          headers: {
            cookie: memberSessionCookie,
            'x-csrf-token': memberCsrf,
            origin: 'http://dashboard.localhost',
          },
        });
        expect(
          memberRes.statusCode,
          `Expected 403 for member role call to admin route "${routeKey}", got ${memberRes.statusCode}`,
        ).toBe(403);
      }
    }
  });

  it('proves actorEmail contains "@" for key.issue, key.revoke, user.invite, user.role_change, user.disable, server.enable/disable, and tool.approve', async () => {
    // 1. key.issue & key.revoke
    const createKeyRes = await testApp.inject({
      method: 'POST',
      url: '/api/keys',
      headers: {
        cookie: memberSessionCookie,
        'x-csrf-token': memberCsrf,
        origin: 'http://dashboard.localhost',
      },
      payload: { name: 'actor-email-key' },
    });
    expect(createKeyRes.statusCode).toBe(201);
    const keyData = JSON.parse(createKeyRes.body);

    const revokeKeyRes = await testApp.inject({
      method: 'DELETE',
      url: `/api/keys/${keyData.id}`,
      headers: {
        cookie: memberSessionCookie,
        'x-csrf-token': memberCsrf,
        origin: 'http://dashboard.localhost',
      },
    });
    expect(revokeKeyRes.statusCode).toBe(200);

    // 2. user.invite
    const inviteRes = await testApp.inject({
      method: 'POST',
      url: '/api/invites',
      headers: {
        cookie: adminSessionCookie,
        'x-csrf-token': adminCsrf,
        origin: 'http://dashboard.localhost',
      },
      payload: { email: `actor-invite-${Date.now()}@conduit.localhost`, role: 'member' },
    });
    expect(inviteRes.statusCode).toBe(201);

    // 3. user.role_change and user.disable
    const tempUserId = new ObjectId();
    await db.collection<UserDocument>('users').insertOne({
      _id: tempUserId,
      email: `actor-target-${Date.now()}@conduit.localhost`,
      name: 'Temp User',
      passwordHash: 'hash',
      role: 'member',
      failedLoginAttempts: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const roleRes = await testApp.inject({
      method: 'PATCH',
      url: `/api/users/${tempUserId.toString()}`,
      headers: {
        cookie: adminSessionCookie,
        'x-csrf-token': adminCsrf,
        origin: 'http://dashboard.localhost',
      },
      payload: { role: 'admin' },
    });
    expect(roleRes.statusCode).toBe(200);

    const disableRes = await testApp.inject({
      method: 'PATCH',
      url: `/api/users/${tempUserId.toString()}`,
      headers: {
        cookie: adminSessionCookie,
        'x-csrf-token': adminCsrf,
        origin: 'http://dashboard.localhost',
      },
      payload: { status: 'disabled' },
    });
    expect(disableRes.statusCode).toBe(200);

    // 4. server.add, server.enable/disable, tool.approve, server.remove
    const srvRes = await testApp.inject({
      method: 'POST',
      url: '/api/servers',
      headers: {
        cookie: adminSessionCookie,
        'x-csrf-token': adminCsrf,
        origin: 'http://dashboard.localhost',
      },
      payload: {
        slug: `srv-${Date.now()}`,
        displayName: 'Actor Email Srv',
        url: 'http://127.0.0.1:9099/mcp',
      },
    });
    expect(srvRes.statusCode).toBe(201);
    const srvData = JSON.parse(srvRes.body);

    const disableSrvRes = await testApp.inject({
      method: 'PATCH',
      url: `/api/servers/${srvData.id}`,
      headers: {
        cookie: adminSessionCookie,
        'x-csrf-token': adminCsrf,
        origin: 'http://dashboard.localhost',
      },
      payload: { enabled: false },
    });
    expect(disableSrvRes.statusCode).toBe(200);

    const enableSrvRes = await testApp.inject({
      method: 'PATCH',
      url: `/api/servers/${srvData.id}`,
      headers: {
        cookie: adminSessionCookie,
        'x-csrf-token': adminCsrf,
        origin: 'http://dashboard.localhost',
      },
      payload: { enabled: true },
    });
    expect(enableSrvRes.statusCode).toBe(200);

    // Seed tool in catalog for tool.approve
    await db.collection('tool_catalog').insertOne({
      serverId: srvData.id,
      name: 'test_tool',
      exposedName: `${srvData.slug}__test_tool`,
      description: 'test description',
      descriptionRaw: 'test description raw',
      inputSchema: { type: 'object' },
      hash: 'hash_test',
      approval: { status: 'pending' },
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      removedAt: null,
    });

    const approveRes = await testApp.inject({
      method: 'POST',
      url: `/api/servers/${srvData.id}/tools/approve`,
      headers: {
        cookie: adminSessionCookie,
        'x-csrf-token': adminCsrf,
        origin: 'http://dashboard.localhost',
      },
      payload: { toolName: 'test_tool' },
    });
    expect(approveRes.statusCode).toBe(200);

    const delSrvRes = await testApp.inject({
      method: 'DELETE',
      url: `/api/servers/${srvData.id}`,
      headers: {
        cookie: adminSessionCookie,
        'x-csrf-token': adminCsrf,
        origin: 'http://dashboard.localhost',
      },
    });
    expect(delSrvRes.statusCode).toBe(200);

    // Verify all generated admin events have actorEmail containing "@"
    const actionsToCheck = [
      'key.issue',
      'key.revoke',
      'user.invite',
      'user.role_change',
      'user.disable',
      'server.enable',
      'server.disable',
      'server.add',
      'server.remove',
      'tool.approve',
    ];

    for (const action of actionsToCheck) {
      const event = await db.collection<AdminEventDocument>('admin_events').findOne(
        { action },
        { sort: { _id: -1 } },
      );
      expect(event, `Expected admin_event row for action "${action}"`).toBeDefined();
      expect(event?.actorEmail, `Expected actorEmail to contain "@" for action "${action}"`).toContain('@');
    }
  });
});

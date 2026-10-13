import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { buildApp } from '../src/app.js';
import { runMigrations } from '../src/db/migrations/runner.js';
import { hashPassword } from '../src/services/password.js';
import type { Config } from '../src/config.js';

describe('Admin Route Access Control Table-Driven Tests', { timeout: 30000 }, () => {
  let client: MongoClient;
  let db: Db;
  let app: any;
  const dbName = `test-route-auth-${Date.now()}`;

  const TEST_MONGO_URI =
    process.env['TEST_MONGO_URI'] ||
    process.env['MONGO_URI'] ||
    'mongodb://root:rootpass@127.0.0.1:27017/conduit_test?authSource=admin';

  const mockConfig: Config = {
    NODE_ENV: 'test',
    PORT: 0,
    HOST: '127.0.0.1',
    LOG_LEVEL: 'silent',
    ALLOWED_ORIGINS: 'http://dashboard.localhost',
    PUBLIC_PORT: 80,
    GLOBAL_DOMAIN: 'localhost',
    MONGO_URI: TEST_MONGO_URI,
    MONGO_DB: dbName,
    API_KEY_PEPPER: 'test-pepper-32-chars-long-minimum!',
    SESSION_SECRET: 'test-session-secret-32-chars-minimum-length!',
    CREDENTIAL_ENC_KEYS: 'k1:MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=',
    WOO_MCP_URL: 'http://127.0.0.1:3100/mcp',
    WOO_MCP_BEARER_TOKEN: 'test-token',
  };

  let memberCookie: string;
  let memberCsrfToken: string;

  beforeAll(async () => {
    client = new MongoClient(mockConfig.MONGO_URI);
    await client.connect();
    db = client.db(dbName);

    await runMigrations(db, 'route-auth-runner');

    const passHash = await hashPassword('MemberPass123!');
    await db.collection('users').insertOne({
      email: 'regular-member@conduit.localhost',
      name: 'Regular Member',
      role: 'member',
      passwordHash: passHash,
      status: 'active',
      disabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    app = buildApp(mockConfig, db);
    await app.ready();

    // Log in as member
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        'content-type': 'application/json',
        origin: 'http://dashboard.localhost',
      },
      payload: {
        email: 'regular-member@conduit.localhost',
        password: 'MemberPass123!',
      },
    });

    expect(loginRes.statusCode).toBe(200);
    const body = loginRes.json();
    memberCsrfToken = body.csrfToken;
    const cookieHeader = loginRes.headers['set-cookie'];
    memberCookie = Array.isArray(cookieHeader) ? cookieHeader[0] : (cookieHeader as string);
  }, 30000);

  afterAll(async () => {
    if (app) await app.close();
    if (db) await db.dropDatabase().catch(() => {});
    if (client) await client.close();
  });

  const adminRoutes: Array<{
    name: string;
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    url: string;
    payload?: Record<string, unknown>;
  }> = [
    { name: 'Create Invite', method: 'POST', url: '/api/invites', payload: { email: 'invitee@conduit.localhost', role: 'member' } },
    { name: 'List Users', method: 'GET', url: '/api/users' },
    { name: 'Update User Role/Status', method: 'PATCH', url: '/api/users/600000000000000000000001', payload: { role: 'member' } },
    { name: 'Create Server', method: 'POST', url: '/api/servers', payload: { slug: 'new-srv', displayName: 'New', url: 'http://example.com' } },
    { name: 'Update Server', method: 'PATCH', url: '/api/servers/600000000000000000000001', payload: { enabled: false } },
    { name: 'Delete Server', method: 'DELETE', url: '/api/servers/600000000000000000000001' },
    { name: 'Test Upstream Server', method: 'POST', url: '/api/servers/test', payload: { url: 'http://example.com' } },
    { name: 'Approve Tool', method: 'POST', url: '/api/servers/600000000000000000000001/tools/approve', payload: { toolName: 'ping' } },
    { name: 'List Admin Events', method: 'GET', url: '/api/admin-events' },
    { name: 'Get Server Stats', method: 'GET', url: '/api/stats/servers' },
  ];

  for (const route of adminRoutes) {
    it(`rejects unauthenticated request with 401 for ${route.method} ${route.url} (${route.name})`, async () => {
      const res = await app.inject({
        method: route.method,
        url: route.url,
        headers: {
          ...(route.payload ? { 'content-type': 'application/json' } : {}),
          origin: 'http://dashboard.localhost',
        },
        payload: route.payload,
      });

      expect(res.statusCode).toBe(401);
    });

    it(`rejects member session request with 403 for ${route.method} ${route.url} (${route.name})`, async () => {
      const res = await app.inject({
        method: route.method,
        url: route.url,
        headers: {
          ...(route.payload ? { 'content-type': 'application/json' } : {}),
          cookie: memberCookie,
          'x-csrf-token': memberCsrfToken,
          origin: 'http://dashboard.localhost',
        },
        payload: route.payload,
      });

      expect(res.statusCode).toBe(403);
    });
  }
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import http from 'node:http';
import { buildApp } from '../src/app.js';
import { runMigrations } from '../src/db/migrations/runner.js';
import { hashPassword } from '../src/services/password.js';
import type { Config } from '../src/config.js';

describe('Dashboard Contract & Server Stats Integration Tests', { timeout: 30000 }, () => {
  let client: MongoClient;
  let db: Db;
  let app: any;
  let mockServer: http.Server;
  let mockServerPort: number;
  const dbName = `test-dashboard-stats-${Date.now()}`;

  const TEST_MONGO_URI =
    process.env['TEST_MONGO_URI'] ||
    process.env['MONGO_URI'] ||
    'mongodb://root:rootpass@127.0.0.1:27017/conduit_test?authSource=admin';

  let testConfig: Config;
  let adminCookie: string;
  let adminCsrfToken: string;
  let memberCookie: string;
  let memberCsrfToken: string;
  let serverId: string;

  beforeAll(async () => {
    // 1. Start a mock upstream server for POST /api/servers/test
    await new Promise<void>((resolve) => {
      mockServer = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          if (!body) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end();
            return;
          }

          let json: any = {};
          try {
            json = JSON.parse(body);
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end();
            return;
          }

          if (json.method === 'initialize') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                id: json.id,
                result: {
                  protocolVersion: '2024-11-05',
                  capabilities: { tools: {} },
                  serverInfo: { name: 'mock-upstream', version: '1.0.0' },
                },
              }),
            );
          } else if (json.method === 'notifications/initialized') {
            res.writeHead(204);
            res.end();
          } else if (json.method === 'ping') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ jsonrpc: '2.0', id: json.id, result: {} }));
          } else if (json.method === 'tools/list') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                id: json.id,
                result: {
                  tools: [
                    {
                      name: 'preview_mock_tool',
                      description: 'A mock tool for testing',
                      inputSchema: { type: 'object' },
                    },
                  ],
                },
              }),
            );
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ jsonrpc: '2.0', id: json.id, result: {} }));
          }
        });
      });
      mockServer.listen(0, '127.0.0.1', () => {
        const addr = mockServer.address() as { port: number };
        mockServerPort = addr.port;
        resolve();
      });
    });

    testConfig = {
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
      PUBLIC_GATEWAY_URL: 'http://gateway.test.local',
      PUBLIC_DASHBOARD_URL: 'http://dashboard.test.local',
      WOO_MCP_URL: `http://127.0.0.1:${mockServerPort}/mcp`,
      WOO_MCP_BEARER_TOKEN: 'seeded-token',
    };

    client = new MongoClient(testConfig.MONGO_URI);
    await client.connect();
    db = client.db(dbName);
    await runMigrations(db, 'dashboard-stats-test-runner');

    // Create admin user
    const adminPassHash = await hashPassword('AdminPass123!');
    await db.collection('users').insertOne({
      email: 'stats-admin@conduit.localhost',
      name: 'Stats Admin',
      role: 'admin',
      passwordHash: adminPassHash,
      status: 'active',
      disabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Create member user
    const memberPassHash = await hashPassword('MemberPass123!');
    await db.collection('users').insertOne({
      email: 'stats-member@conduit.localhost',
      name: 'Stats Member',
      role: 'member',
      passwordHash: memberPassHash,
      status: 'active',
      disabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    app = buildApp(testConfig, db);
    await app.ready();

    // Log in admin
    const adminLoginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        'content-type': 'application/json',
        origin: 'http://dashboard.localhost',
      },
      payload: {
        email: 'stats-admin@conduit.localhost',
        password: 'AdminPass123!',
      },
    });
    expect(adminLoginRes.statusCode).toBe(200);
    adminCsrfToken = adminLoginRes.json().csrfToken;
    const adminCookies = adminLoginRes.headers['set-cookie'];
    adminCookie = Array.isArray(adminCookies) ? adminCookies[0] : (adminCookies as string);

    // Log in member
    const memberLoginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        'content-type': 'application/json',
        origin: 'http://dashboard.localhost',
      },
      payload: {
        email: 'stats-member@conduit.localhost',
        password: 'MemberPass123!',
      },
    });
    expect(memberLoginRes.statusCode).toBe(200);
    memberCsrfToken = memberLoginRes.json().csrfToken;
    const memberCookies = memberLoginRes.headers['set-cookie'];
    memberCookie = Array.isArray(memberCookies) ? memberCookies[0] : (memberCookies as string);

    // Seed a test MCP server and tools in the catalog
    const serverInsert = await db.collection('mcp_servers').insertOne({
      slug: 'test-dash-server',
      displayName: 'Dashboard Contract Server',
      url: `http://127.0.0.1:${mockServerPort}/mcp`,
      auth: { type: 'none' },
      enabled: true,
      trusted: true,
      system: false,
      origin: 'admin',
      callTimeoutMs: 15000,
      maxConcurrent: 5,
      approveOnAdd: false,
      status: 'healthy',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    serverId = serverInsert.insertedId.toString();

    // Seed tools in catalog: one approved, one pending
    await db.collection('tool_catalog').insertMany([
      {
        serverId,
        name: 'approved_tool',
        exposedName: 'test-dash-server__approved_tool',
        description: 'Sanitized approved description',
        descriptionRaw: 'Raw un-sanitized approved description with tags',
        inputSchema: { type: 'object' },
        hash: 'hash-approved-123',
        approval: {
          status: 'approved',
          approvedBy: 'admin',
          approvedAt: new Date(),
          hashAtApproval: 'hash-approved-123',
        },
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        removedAt: null,
      },
      {
        serverId,
        name: 'pending_tool',
        exposedName: 'test-dash-server__pending_tool',
        description: 'Sanitized pending description',
        descriptionRaw: 'Raw pending description',
        inputSchema: { type: 'object' },
        hash: 'hash-pending-456',
        approval: {
          status: 'pending',
          hashAtApproval: null,
        },
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        removedAt: null,
      },
    ]);
  }, 30000);

  afterAll(async () => {
    if (app) await app.close();
    if (mockServer) {
      await new Promise<void>((resolve) => mockServer.close(() => resolve()));
    }
    if (db) await db.dropDatabase().catch(() => {});
    if (client) await client.close();
  });

  describe('Dashboard Contract Endpoints', () => {
    it('GET /api/config returns public configuration without exposing secrets', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/config',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toEqual({
        publicGatewayUrl: 'http://gateway.test.local',
        publicDashboardUrl: 'http://dashboard.test.local',
        version: '0.1.0',
      });
      // Ensure no secrets leaked
      const bodyStr = res.payload;
      expect(bodyStr).not.toContain('test-pepper');
      expect(bodyStr).not.toContain('test-session-secret');
      expect(bodyStr).not.toContain('k1:');
    });

    it('GET /api/servers/:id/tools returns full metadata for admin, approved only for member', async () => {
      // 1. Admin request
      const adminRes = await app.inject({
        method: 'GET',
        url: `/api/servers/${serverId}/tools`,
        headers: { cookie: adminCookie },
      });
      expect(adminRes.statusCode).toBe(200);
      const adminTools = adminRes.json().tools;
      expect(adminTools).toHaveLength(2);

      const approvedToolAdmin = adminTools.find((t: any) => t.name === 'approved_tool');
      expect(approvedToolAdmin.approval.status).toBe('approved');
      expect(approvedToolAdmin.descriptionRaw).toBe('Raw un-sanitized approved description with tags');
      expect(approvedToolAdmin.hash).toBe('hash-approved-123');

      const pendingToolAdmin = adminTools.find((t: any) => t.name === 'pending_tool');
      expect(pendingToolAdmin.approval.status).toBe('pending');
      expect(pendingToolAdmin.descriptionRaw).toBe('Raw pending description');

      // 2. Member request - MUST return approved tools only, omitting internal raw fields
      const memberRes = await app.inject({
        method: 'GET',
        url: `/api/servers/${serverId}/tools`,
        headers: { cookie: memberCookie },
      });
      expect(memberRes.statusCode).toBe(200);
      const memberTools = memberRes.json().tools;
      expect(memberTools).toHaveLength(1);
      expect(memberTools[0].name).toBe('approved_tool');
      expect(memberTools[0].descriptionRaw).toBeUndefined();
      expect(memberTools[0].approval).toBeUndefined();
      expect(memberTools[0].hash).toBeUndefined();
    });

    it('POST /api/servers/:id/tools/approve allows admin to approve a pending tool and records actorEmail', async () => {
      // Member is forbidden
      const memberForbidden = await app.inject({
        method: 'POST',
        url: `/api/servers/${serverId}/tools/approve`,
        headers: {
          cookie: memberCookie,
          'x-csrf-token': memberCsrfToken,
          origin: 'http://dashboard.localhost',
        },
        payload: { toolName: 'pending_tool' },
      });
      expect(memberForbidden.statusCode).toBe(403);

      // Admin approves
      const adminApprove = await app.inject({
        method: 'POST',
        url: `/api/servers/${serverId}/tools/approve`,
        headers: {
          cookie: adminCookie,
          'x-csrf-token': adminCsrfToken,
          origin: 'http://dashboard.localhost',
        },
        payload: { toolName: 'pending_tool' },
      });
      expect(adminApprove.statusCode).toBe(200);
      expect(adminApprove.json().tool.approval.status).toBe('approved');

      // Verify admin_events has actorEmail containing @
      const event = await db.collection('admin_events').findOne({
        action: 'tool.approve',
        'details.toolName': 'pending_tool',
      });
      expect(event).toBeDefined();
      expect(event?.actorEmail).toContain('@');
      expect(event?.actorEmail).toBe('stats-admin@conduit.localhost');
    });

    it('POST /api/servers/test connects upstream and returns tools without saving, respecting UrlPolicy', async () => {
      // 1. Valid test to mock server
      const validTest = await app.inject({
        method: 'POST',
        url: '/api/servers/test',
        headers: {
          cookie: adminCookie,
          'x-csrf-token': adminCsrfToken,
          origin: 'http://dashboard.localhost',
        },
        payload: {
          url: `http://127.0.0.1:${mockServerPort}/mcp`,
          auth: { type: 'none' },
        },
      });
      expect(validTest.statusCode).toBe(200);
      const body = validTest.json();
      expect(body.ok).toBe(true);
      expect(body.toolsCount).toBe(1);
      expect(body.tools[0].name).toBe('preview_mock_tool');

      // Verify server was NOT saved in database
      const count = await db.collection('mcp_servers').countDocuments({ slug: 'preview_mock_tool' });
      expect(count).toBe(0);

      // 2. Member cannot call POST /api/servers/test
      const memberRes = await app.inject({
        method: 'POST',
        url: '/api/servers/test',
        headers: {
          cookie: memberCookie,
          'x-csrf-token': memberCsrfToken,
          origin: 'http://dashboard.localhost',
        },
        payload: {
          url: `http://127.0.0.1:${mockServerPort}/mcp`,
          auth: { type: 'none' },
        },
      });
      expect(memberRes.statusCode).toBe(403);
    });

    it('enforces canonical POST /api/auth/accept-invite and rejects obsolete /api/invites/accept alias', async () => {
      // Create an invite
      const inviteToken = 'test-invite-token-abc-123';
      const crypto = await import('node:crypto');
      const tokenHash = crypto.createHash('sha256').update(inviteToken).digest('hex');
      await db.collection('invites').insertOne({
        email: 'invited-canonical@conduit.localhost',
        role: 'member',
        tokenHash,
        invitedBy: 'stats-admin@conduit.localhost',
        expiresAt: new Date(Date.now() + 86400000),
        usedAt: null,
        createdAt: new Date(),
      });

      // Old alias /api/invites/accept returns 404
      const aliasRes = await app.inject({
        method: 'POST',
        url: '/api/invites/accept',
        headers: {
          'content-type': 'application/json',
          origin: 'http://dashboard.localhost',
        },
        payload: {
          token: inviteToken,
          password: 'NewUserPassword123!',
          name: 'Invited User',
        },
      });
      expect(aliasRes.statusCode).toBe(404);

      // Canonical /api/auth/accept-invite succeeds
      const canonicalRes = await app.inject({
        method: 'POST',
        url: '/api/auth/accept-invite',
        headers: {
          'content-type': 'application/json',
          origin: 'http://dashboard.localhost',
        },
        payload: {
          token: inviteToken,
          password: 'NewUserPassword123!',
          name: 'Invited User',
        },
      });
      expect(canonicalRes.statusCode).toBe(200);
      expect(canonicalRes.json().email).toBe('invited-canonical@conduit.localhost');
    });
  });

  describe('GET /api/stats/servers Endpoints', () => {
    it('member cannot access /api/stats/servers (403)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/stats/servers',
        headers: { cookie: memberCookie },
      });
      expect(res.statusCode).toBe(403);
    });

    it('computes totalCalls24h, errorRate24h, p50, p95 durations, lastError, and lastSuccessAt from seeded audit rows', async () => {
      const now = Date.now();
      const serverSlug = 'stats-test-server';

      // Seed audit records within the last 24h:
      // 10 calls: 8 successes, 2 errors (error rate = 0.2000)
      // Durations: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
      // p50 (idx 5) = 60, p95 (idx 9) = 100
      const toolCalls = [
        {
          requestId: 'req-1',
          userId: 'user-1',
          keyId: 'key-1',
          serverSlug,
          tool: 'tool_1',
          callId: 'call-1',
          argsHash: 'hash-1',
          durationMs: 10,
          outcome: 'success',
          ts: new Date(now - 3600000), // 1h ago
        },
        {
          requestId: 'req-2',
          userId: 'user-1',
          keyId: 'key-1',
          serverSlug,
          tool: 'tool_1',
          callId: 'call-2',
          argsHash: 'hash-2',
          durationMs: 20,
          outcome: 'success',
          ts: new Date(now - 3500000),
        },
        {
          requestId: 'req-3',
          userId: 'user-1',
          keyId: 'key-1',
          serverSlug,
          tool: 'tool_1',
          callId: 'call-3',
          argsHash: 'hash-3',
          durationMs: 30,
          outcome: 'success',
          ts: new Date(now - 3400000),
        },
        {
          requestId: 'req-4',
          userId: 'user-1',
          keyId: 'key-1',
          serverSlug,
          tool: 'tool_1',
          callId: 'call-4',
          argsHash: 'hash-4',
          durationMs: 40,
          outcome: 'success',
          ts: new Date(now - 3300000),
        },
        {
          requestId: 'req-5',
          userId: 'user-1',
          keyId: 'key-1',
          serverSlug,
          tool: 'tool_1',
          callId: 'call-5',
          argsHash: 'hash-5',
          durationMs: 50,
          outcome: 'success',
          ts: new Date(now - 3200000),
        },
        {
          requestId: 'req-6',
          userId: 'user-1',
          keyId: 'key-1',
          serverSlug,
          tool: 'tool_1',
          callId: 'call-6',
          argsHash: 'hash-6',
          durationMs: 60,
          outcome: 'success',
          ts: new Date(now - 3100000),
        },
        {
          requestId: 'req-7',
          userId: 'user-1',
          keyId: 'key-1',
          serverSlug,
          tool: 'tool_1',
          callId: 'call-7',
          argsHash: 'hash-7',
          durationMs: 70,
          outcome: 'success',
          ts: new Date(now - 3000000),
        },
        {
          requestId: 'req-8',
          userId: 'user-1',
          keyId: 'key-1',
          serverSlug,
          tool: 'tool_1',
          callId: 'call-8',
          argsHash: 'hash-8',
          durationMs: 80,
          outcome: 'success',
          ts: new Date(now - 100000), // Recent success (lastSuccessAt)
        },
        {
          requestId: 'req-9',
          userId: 'user-1',
          keyId: 'key-1',
          serverSlug,
          tool: 'tool_1',
          callId: 'call-9',
          argsHash: 'hash-9',
          durationMs: 90,
          outcome: 'error',
          errorCode: 'UPSTREAM_TIMEOUT',
          ts: new Date(now - 50000), // Recent error (lastError)
        },
        {
          requestId: 'req-10',
          userId: 'user-1',
          keyId: 'key-1',
          serverSlug,
          tool: 'tool_1',
          callId: 'call-10',
          argsHash: 'hash-10',
          durationMs: 100,
          outcome: 'error',
          errorCode: 'UPSTREAM_ERROR',
          ts: new Date(now - 200000),
        },
        // Old row (>24h ago) - MUST be ignored by 24h filter
        {
          requestId: 'req-old',
          userId: 'user-1',
          keyId: 'key-1',
          serverSlug,
          tool: 'tool_1',
          callId: 'call-old',
          argsHash: 'hash-old',
          durationMs: 999,
          outcome: 'error',
          errorCode: 'IGNORED_OLD',
          ts: new Date(now - 30 * 3600000),
        },
      ];

      await db.collection('tool_calls').insertMany(toolCalls);

      const res = await app.inject({
        method: 'GET',
        url: '/api/stats/servers',
        headers: { cookie: adminCookie },
      });

      expect(res.statusCode).toBe(200);
      const serverStats = res.json().stats.find((s: any) => s.serverSlug === serverSlug);
      expect(serverStats).toBeDefined();

      expect(serverStats.totalCalls24h).toBe(10);
      expect(serverStats.errorRate24h).toBe(0.2); // 2 out of 10
      expect(serverStats.p50).toBe(60);
      expect(serverStats.p95).toBe(100);
      expect(serverStats.lastError).toBeDefined();
      expect(serverStats.lastError.code).toBe('UPSTREAM_TIMEOUT');
      expect(new Date(serverStats.lastSuccessAt).getTime()).toBe(now - 100000);
    });
  });
});

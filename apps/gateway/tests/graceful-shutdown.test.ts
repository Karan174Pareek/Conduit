import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { MongoClient, type Db } from 'mongodb';
import { buildApp } from '../src/app.js';
import { runMigrations } from '../src/db/migrations/runner.js';
import { createApiKey } from '../src/services/api-keys.js';
import { hashPassword } from '../src/services/password.js';
import type { Config } from '../src/config.js';
import type { McpServerDocument, ToolCatalogDocument, ToolCallDocument } from '../src/db/types.js';
import { getIsolatedTestDbUri } from './test-db-helper.js';

describe('Graceful Shutdown In-Flight Request and Audit Proof', { timeout: 30000 }, () => {
  let client: MongoClient;
  let db: Db;
  let mockServer: http.Server;
  let mockServerUrl: string;
  const { dbName, uri: TEST_MONGO_URI } = getIsolatedTestDbUri('shutdown');

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

  let memberApiKey: string;
  let memberUserId: string;

  beforeAll(async () => {
    // 1. Start mock server with a slow tool (300ms delay) and proper MCP handshake
    mockServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
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
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            id: json.id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'mock-slow', version: '1.0.0' },
            },
          }));
        } else if (json.method === 'notifications/initialized') {
          res.writeHead(204);
          res.end();
        } else if (json.method === 'ping') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: json.id, result: {} }));
        } else if (json.method === 'tools/list') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            id: json.id,
            result: {
              tools: [{ name: 'slow_tool', description: 'Simulates slow in-flight execution' }],
            },
          }));
        } else if (json.method === 'tools/call') {
          setTimeout(() => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              id: json.id,
              result: {
                content: [{ type: 'text', text: 'slow_done' }],
                isError: false,
              },
            }));
          }, 300);
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: json.id, result: {} }));
        }
      });
    });

    await new Promise<void>((resolve) => {
      mockServer.listen(0, '127.0.0.1', () => {
        const addr = mockServer.address() as { port: number };
        mockServerUrl = `http://127.0.0.1:${addr.port}/mcp`;
        resolve();
      });
    });

    // 2. Connect DB & migrate
    client = new MongoClient(mockConfig.MONGO_URI);
    await client.connect();
    db = client.db(dbName);
    await runMigrations(db, 'shutdown-runner');

    // 3. Insert mock server
    const serverInsert = await db.collection<McpServerDocument>('mcp_servers').insertOne({
      slug: 'slowsrv',
      displayName: 'Slow Upstream Server',
      url: mockServerUrl,
      enabled: true,
      trusted: true,
      system: false,
      origin: 'admin',
      auth: { type: 'none' },
      callTimeoutMs: 5000,
      maxConcurrent: 8,
      approveOnAdd: true,
      status: { state: 'connected', reasonCode: null, reason: null, checkedAt: null, lastSuccessAt: null },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await db.collection<ToolCatalogDocument>('tool_catalog').insertOne({
      serverId: serverInsert.insertedId.toString(),
      serverSlug: 'slowsrv',
      name: 'slow_tool',
      exposedName: 'slowsrv__slow_tool',
      description: 'Slow tool',
      inputSchema: { type: 'object' },
      approval: { status: 'approved', approvedBy: 'system', approvedAt: new Date() },
      status: 'active',
      quarantineReason: null,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      removedAt: null,
      updatedAt: new Date(),
    });

    // 4. Create user and key
    const passHash = await hashPassword('Pass123!');
    const userInsert = await db.collection('users').insertOne({
      email: 'shutdown-member@conduit.localhost',
      name: 'Shutdown Member',
      role: 'member',
      passwordHash: passHash,
      status: 'active',
      disabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    memberUserId = userInsert.insertedId.toString();

    const keyData = await createApiKey(db, mockConfig.API_KEY_PEPPER, memberUserId, 'shutdown-key');
    memberApiKey = keyData.key;
  });

  afterAll(async () => {
    if (mockServer) mockServer.close();
    if (db) await db.dropDatabase().catch(() => {});
    if (client) await client.close();
  });

  it('proves in-flight tools/call completes and audit row is written when shutdown initiates', async () => {
    let isShuttingDown = false;
    const app = buildApp(mockConfig, db, { isReady: () => !isShuttingDown });
    const mgr = (app as any).upstreamManager;
    await mgr.loadServers();
    await app.ready();

    // 1. Initial readyz probe returns 200 OK
    const initialReady = await app.inject({ method: 'GET', url: '/readyz' });
    expect(initialReady.statusCode).toBe(200);

    // 2. Launch in-flight tools/call request (takes 300ms)
    const inFlightPromise = app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: `Bearer ${memberApiKey}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: {
        jsonrpc: '2.0',
        id: 99,
        method: 'tools/call',
        params: {
          name: 'slowsrv__slow_tool',
          arguments: { test: 123 },
        },
      },
    });

    // 3. After 50ms (while call is actively in-flight), initiate graceful shutdown
    await new Promise((r) => setTimeout(r, 50));
    isShuttingDown = true;

    // 4. /readyz MUST IMMEDIATELY return 503 so load balancer stops sending traffic
    const shutdownReady = await app.inject({ method: 'GET', url: '/readyz' });
    expect(shutdownReady.statusCode).toBe(503);
    expect(shutdownReady.json().status).toBe('unready');
    expect(shutdownReady.json().reason).toContain('shutting down');

    // 5. In-flight tool call completes successfully despite shutdown being in progress
    const callRes = await inFlightPromise;
    expect(callRes.statusCode).toBe(200);
    const dataLine = callRes.payload.split('\n').find((l: string) => l.startsWith('data: '));
    const body = JSON.parse(dataLine ? dataLine.replace(/^data: /, '') : callRes.payload);
    expect(body.result.content[0].text).toBe('slow_done');

    // 6. Close app and flush audit sink
    await app.close();
    const auditSink = (app as any).auditSink;
    await auditSink.close();

    // 7. Verify the audit row was flushed and written to tool_calls in MongoDB
    const auditRow = await db.collection<ToolCallDocument>('tool_calls').findOne({
      userId: memberUserId,
      serverSlug: 'slowsrv',
      tool: 'slow_tool',
    });

    expect(auditRow).toBeDefined();
    expect(auditRow!.outcome).toBe('success');
    expect(auditRow!.durationMs).toBeGreaterThanOrEqual(250);
  });
});

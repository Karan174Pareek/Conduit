import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { MongoClient, type Db } from 'mongodb';
import { buildApp } from '../src/app.js';
import { type Config, parseEncryptionKeys } from '../src/config.js';
import { runMigrations } from '../src/db/migrations/runner.js';
import { bootstrapAdmin } from '../src/services/bootstrap.js';
import { seedDefaultServers } from '../src/registry/seed.js';
import { CredentialCrypto } from '../src/registry/crypto.js';
import { createApiKey, revokeApiKey } from '../src/services/api-keys.js';
import type { UpstreamManager } from '../src/upstream/manager.js';
import type { ToolRouter } from '../src/router/tool-router.js';
import type { SystemStateDocument, McpServerDocument } from '../src/db/types.js';
import { getIsolatedTestDbUri } from './test-db-helper.js';

describe('Phase 3B Gateway Core & /mcp Integration Tests', { timeout: 30000 }, () => {
  let mongoClient: MongoClient;
  let db: Db;
  const mockServers: http.Server[] = [];
  let serverAlphaUrl: string;
  let serverBetaUrl: string;
  let _serverHungUrl: string;

  const { dbName: testDbName, uri: mongoUri } = getIsolatedTestDbUri('3b');

  const testConfig: Config = {
    PORT: 0,
    HOST: '127.0.0.1',
    MONGO_URI: mongoUri,
    SESSION_SECRET: '0'.repeat(64),
    API_KEY_PEPPER: '1'.repeat(64),
    CREDENTIAL_ENC_KEYS: 'k1:MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=', // 32 bytes
    BOOTSTRAP_ADMIN_EMAIL: 'admin@conduit.localhost',
    BOOTSTRAP_ADMIN_PASSWORD: 'adminPassword123!',
    PUBLIC_DASHBOARD_URL: 'http://dashboard.localhost',
    PUBLIC_GATEWAY_URL: 'http://gateway.localhost',
    ALLOWED_ORIGINS: 'http://dashboard.localhost,http://localhost',
    WOO_MCP_URL: 'http://127.0.0.1:9999/mcp',
    WOO_MCP_BEARER_TOKEN: 'seeded-woo-secret-token-value',
    LOG_LEVEL: 'fatal',
  };

  // Helper to start an ephemeral HTTP mock MCP server
  async function startMockServer(
    toolDefinitions: Array<{ name: string; description: string }>,
    callPrefix: string,
  ): Promise<{ server: http.Server; url: string }> {
    return new Promise((resolve) => {
      const server = http.createServer((req, res) => {
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
                  tools: toolDefinitions.map((t) => ({
                    name: t.name,
                    description: t.description,
                    inputSchema: { type: 'object' },
                  })),
                },
              }),
            );
          } else if (json.method === 'tools/call') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                id: json.id,
                result: {
                  content: [{ type: 'text', text: `${callPrefix}:${json.params.name}` }],
                  isError: false,
                },
              }),
            );
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ jsonrpc: '2.0', id: json.id, result: {} }));
          }
        });
      });

      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as { port: number };
        mockServers.push(server);
        resolve({ server, url: `http://127.0.0.1:${addr.port}/mcp` });
      });
    });
  }

  beforeAll(async () => {
    mongoClient = new MongoClient(mongoUri);
    await mongoClient.connect();
    db = mongoClient.db(testDbName);
    await db.dropDatabase();

    // 1. Mock Server Alpha (exposes ping and search)
    const alpha = await startMockServer(
      [
        { name: 'ping', description: 'Alpha ping' },
        { name: 'search', description: 'Alpha search' },
      ],
      'alpha',
    );
    serverAlphaUrl = alpha.url;

    // 2. Mock Server Beta (also exposes ping and search)
    const beta = await startMockServer(
      [
        { name: 'ping', description: 'Beta ping' },
        { name: 'search', description: 'Beta search' },
      ],
      'beta',
    );
    serverBetaUrl = beta.url;

    // 3. Mock Server Hung (never answers)
    const hung = await new Promise<{ server: http.Server; url: string }>((resolve) => {
      const server = http.createServer((_req, _res) => {
        // Do not respond; let caller timeout
      });
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as { port: number };
        mockServers.push(server);
        resolve({ server, url: `http://127.0.0.1:${addr.port}/mcp` });
      });
    });
    _serverHungUrl = hung.url;

    // Initialize DB schema
    await runMigrations(db);
    await bootstrapAdmin(db, testConfig);
  });

  afterAll(async () => {
    for (const s of mockServers) {
      s.close();
    }
    if (db) {
      try {
        await db.dropDatabase();
      } catch (_err) {
        void _err;
      }
    }
    if (mongoClient) {
      await mongoClient.close();
    }
  });

  it('runs seed idempotency and never reveals raw secrets', async () => {
    const keys = parseEncryptionKeys(testConfig.CREDENTIAL_ENC_KEYS);
    const crypto = new CredentialCrypto(keys);

    // First seed run
    await seedDefaultServers(
      db,
      crypto,
      { wooMcpUrl: testConfig.WOO_MCP_URL, wooMcpBearerToken: testConfig.WOO_MCP_BEARER_TOKEN },
    );

    const doc1 = await db.collection<McpServerDocument>('mcp_servers').findOne({ slug: 'woo' });
    expect(doc1).not.toBeNull();
    expect(doc1?.trusted).toBe(true);
    expect(doc1?.system).toBe(true);
    expect(doc1?.auth.ciphertext).toBeDefined();

    // Verify raw secret was encrypted and not plaintext in DB
    expect(JSON.stringify(doc1)).not.toContain('seeded-woo-secret-token-value');

    // Second seed run (idempotent)
    await seedDefaultServers(
      db,
      crypto,
      { wooMcpUrl: testConfig.WOO_MCP_URL, wooMcpBearerToken: testConfig.WOO_MCP_BEARER_TOKEN },
    );
    const doc2 = await db.collection<McpServerDocument>('mcp_servers').findOne({ slug: 'woo' });
    expect(doc2?.updatedAt.getTime()).toBe(doc1?.updatedAt.getTime());
  });

  it('proves configVersion convergence between two gateway app instances', async () => {
    const app1 = buildApp(testConfig, db);
    const app2 = buildApp(testConfig, db);

    const mgr1 = (app1 as any).upstreamManager as UpstreamManager;
    const mgr2 = (app2 as any).upstreamManager as UpstreamManager;

    await mgr1.loadServers();
    await mgr2.loadServers();

    // Admin writes a new server via app1 using session cookie & csrf
    const loginRes = await app1.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        'content-type': 'application/json',
        origin: 'http://dashboard.localhost',
      },
      payload: {
        email: testConfig.BOOTSTRAP_ADMIN_EMAIL,
        password: testConfig.BOOTSTRAP_ADMIN_PASSWORD,
      },
    });
    expect(loginRes.statusCode).toBe(200);
    const adminCookie = loginRes.headers['set-cookie'] as string;
    const adminCsrf = loginRes.json().csrfToken;

    // Change password from bootstrap default
    await app1.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: {
        cookie: adminCookie,
        'x-csrf-token': adminCsrf,
        origin: 'http://dashboard.localhost',
      },
      payload: {
        currentPassword: testConfig.BOOTSTRAP_ADMIN_PASSWORD,
        newPassword: 'SuperSecurePassword2026!',
      },
    });

    const createRes = await app1.inject({
      method: 'POST',
      url: '/api/servers',
      headers: {
        cookie: adminCookie,
        'x-csrf-token': adminCsrf,
        origin: 'http://dashboard.localhost',
      },
      payload: {
        slug: 'instance-test-srv',
        displayName: 'Convergence Test Server',
        url: serverAlphaUrl,
        enabled: true,
      },
    });
    expect(createRes.statusCode).toBe(201);

    // Verify configVersion bumped in system_state
    const stateDoc = await db.collection<SystemStateDocument>('system_state').findOne({ _id: 'config' });
    expect(stateDoc?.configVersion).toBeGreaterThan(1);

    // Instance 2 reloads on configVersion bump and converges
    await mgr2.loadServers();
    expect(mgr2.getServerState('instance-test-srv')).toBeDefined();

    await app1.close();
    await app2.close();
  });

  it('enforces /mcp authentication strictly (valid key, revoked key, no key, session cookie rejected)', async () => {
    const app = buildApp(testConfig, db);
    const adminUser = await db.collection('users').findOne({ email: testConfig.BOOTSTRAP_ADMIN_EMAIL });

    const { key: validKey, id: keyId } = await createApiKey(
      db,
      testConfig.API_KEY_PEPPER,
      adminUser!._id.toString(),
      'mcp-test-key',
    );

    // 1. Missing key -> 401 with WWW-Authenticate
    const resNoKey = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        'content-type': 'application/json',
      },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    expect(resNoKey.statusCode).toBe(401);
    expect(resNoKey.headers['www-authenticate']).toBe('Bearer');

    // 2. Session cookie instead of Bearer -> 401 (sessions disallowed on /mcp)
    const resCookie = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        cookie: 'session_id=some-session-token',
        'content-type': 'application/json',
      },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    expect(resCookie.statusCode).toBe(401);

    // 3. Invalid / malformed key -> 401
    const resBadKey = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: 'Bearer ' + 'mcpgw_' + '00000000_invalidsecretkeythatisnotpresent', // gitleaks:allow
        'content-type': 'application/json',
      },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    expect(resBadKey.statusCode).toBe(401);

    // 4. Revoked key -> 401 with identical body shape
    await revokeApiKey(db, keyId, adminUser!._id.toString(), true);
    const resRevokedKey = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: `Bearer ${validKey}`,
        'content-type': 'application/json',
      },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    expect(resRevokedKey.statusCode).toBe(401);
    expect(resRevokedKey.body).toBe(resBadKey.body); // Zero oracle difference

    await app.close();
  });

  it('routes colliding tool names from distinct servers correctly and isolates dead upstreams', async () => {
    const app = buildApp(testConfig, db);
    const mgr = (app as any).upstreamManager as UpstreamManager;
    const router = (app as any).toolRouter as ToolRouter;

    // Insert Alpha and Beta in DB as well
    await db.collection<McpServerDocument>('mcp_servers').insertOne({
      slug: 'alpha',
      displayName: 'Alpha Service',
      url: serverAlphaUrl,
      enabled: true,
      trusted: true, // auto-approve tools
      system: false,
      origin: 'admin',
      auth: { type: 'none' },
      callTimeoutMs: 1000,
      maxConcurrent: 8,
      approveOnAdd: true,
      status: { state: 'connected', reasonCode: null, reason: null, checkedAt: null, lastSuccessAt: null },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await db.collection<McpServerDocument>('mcp_servers').insertOne({
      slug: 'beta',
      displayName: 'Beta Service',
      url: serverBetaUrl,
      enabled: true,
      trusted: true,
      system: false,
      origin: 'admin',
      auth: { type: 'none' },
      callTimeoutMs: 1000,
      maxConcurrent: 8,
      approveOnAdd: true,
      status: { state: 'connected', reasonCode: null, reason: null, checkedAt: null, lastSuccessAt: null },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await mgr.loadServers();

    // Trigger catalog fetch for alpha and beta
    await mgr.runCatalogRefreshLoop();

    const principal = { userId: 'usr_1', role: 'member' as const, via: 'apikey' as const };
    const listedTools = await router.list(principal);

    // Both servers appear with distinct prefixes for ping and search
    const alphaPing = listedTools.find((t) => t.name === 'alpha__ping');
    const betaPing = listedTools.find((t) => t.name === 'beta__ping');
    const alphaSearch = listedTools.find((t) => t.name === 'alpha__search');
    const betaSearch = listedTools.find((t) => t.name === 'beta__search');

    expect(alphaPing).toBeDefined();
    expect(betaPing).toBeDefined();
    expect(alphaSearch).toBeDefined();
    expect(betaSearch).toBeDefined();
    expect(alphaPing?.description).toContain('[Alpha Service]');
    expect(betaPing?.description).toContain('[Beta Service]');
    expect(alphaSearch?.description).toContain('[Alpha Service]');
    expect(betaSearch?.description).toContain('[Beta Service]');

    // Routing calls to each routes to the respective server
    const resAlpha = await router.call(principal, 'alpha__ping', {});
    expect(resAlpha.content[0]?.text).toBe('alpha:ping');

    const resBeta = await router.call(principal, 'beta__ping', {});
    expect(resBeta.content[0]?.text).toBe('beta:ping');

    const resAlphaSearch = await router.call(principal, 'alpha__search', {});
    expect(resAlphaSearch.content[0]?.text).toBe('alpha:search');

    const resBetaSearch = await router.call(principal, 'beta__search', {});
    expect(resBetaSearch.content[0]?.text).toBe('beta:search');

    // Add hung upstream to prove it does not delay calls or listing of active servers
    await db.collection<McpServerDocument>('mcp_servers').insertOne({
      slug: 'hung-srv',
      displayName: 'Hung Service',
      url: _serverHungUrl,
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
    await mgr.loadServers();

    // Dead or hung upstream does not delay calls to other servers (timing assertion < 100ms)
    const startCall = Date.now();
    const immediateCall = await router.call(principal, 'alpha__ping', {});
    const callElapsed = Date.now() - startCall;
    expect(immediateCall.content[0]?.text).toBe('alpha:ping');
    expect(callElapsed).toBeLessThan(100);

    // Dead upstream does not delay calls or listing of alpha and beta
    const startListing = Date.now();
    const immediateTools = await router.list(principal);
    const listingElapsed = Date.now() - startListing;
    expect(immediateTools.length).toBeGreaterThanOrEqual(2);
    expect(listingElapsed).toBeLessThan(100); // Served from cache within milliseconds!

    await app.close();
  });
});

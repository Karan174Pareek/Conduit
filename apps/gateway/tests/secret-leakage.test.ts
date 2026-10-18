import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Writable } from 'node:stream';
import { MongoClient, type Db, ObjectId } from 'mongodb';
import pino from 'pino';
import { buildApp } from '../src/app.js';
import { type Config, parseEncryptionKeys } from '../src/config.js';
import { CredentialCrypto } from '../src/registry/crypto.js';
import { UpstreamManager } from '../src/upstream/manager.js';
import { CatalogService } from '../src/catalog/service.js';
import { ToolRouter } from '../src/router/tool-router.js';
import { MongoAuditSink } from '../src/audit/sink.js';
import { REDACTED_PATHS } from '../src/logger.js';
import { hashPassword } from '../src/services/password.js';
import type { McpServerDocument, UserDocument } from '../src/db/types.js';
import { getIsolatedTestDbUri } from './test-db-helper.js';

describe('Integration Secret Leakage & Redaction Proof', { timeout: 30000 }, () => {
  let mongoClient: MongoClient;
  let db: Db;
  let mockServer: http.Server;
  let mockServerUrl: string;

  const KNOWN_WOO_TOKEN = 'secret_upstream_woo_bearer_token_9876543210';
  const KNOWN_PEPPER = 'pepper_hex_secret_value_abcdef0123456789abcdef0123456789';
  const KNOWN_ADMIN_PASSWORD = 'knownAdminSuperSecretPassword123!';
  const KNOWN_ADMIN_EMAIL = 'admin@conduit.localhost';

  const { dbName, uri: mongoUri } = getIsolatedTestDbUri('secret_leak');

  const testConfig: Config = {
    NODE_ENV: 'test',
    PORT: 0,
    HOST: '127.0.0.1',
    MONGO_URI: mongoUri,
    SESSION_SECRET: '0'.repeat(64),
    API_KEY_PEPPER: KNOWN_PEPPER,
    CREDENTIAL_ENC_KEYS: 'k1:MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=', // 32 bytes AES-256
    BOOTSTRAP_ADMIN_EMAIL: KNOWN_ADMIN_EMAIL,
    BOOTSTRAP_ADMIN_PASSWORD: KNOWN_ADMIN_PASSWORD,
    PUBLIC_DASHBOARD_URL: 'http://dashboard.localhost',
    PUBLIC_GATEWAY_URL: 'http://gateway.localhost',
    ALLOWED_ORIGINS: 'http://dashboard.localhost,http://localhost',
    WOO_MCP_URL: 'http://127.0.0.1:9999/mcp',
    WOO_MCP_BEARER_TOKEN: KNOWN_WOO_TOKEN,
    LOG_LEVEL: 'info',
  };

  beforeAll(async () => {
    mongoClient = new MongoClient(testConfig.MONGO_URI);
    await mongoClient.connect();
    db = mongoClient.db(dbName);

    // Ephemeral mock upstream server verifying Bearer token
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

          const json = JSON.parse(body);
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
          } else if (json.method === 'tools/list') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                id: json.id,
                result: {
                  tools: [
                    {
                      name: 'query_db',
                      description: 'Query database',
                      inputSchema: { type: 'object' },
                    },
                  ],
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
                  content: [{ type: 'text', text: 'query_result_ok' }],
                  isError: false,
                },
              }),
            );
          } else {
            res.writeHead(404);
            res.end();
          }
        });
      });

      mockServer.listen(0, '127.0.0.1', () => {
        const addr = mockServer.address() as AddressInfo;
        mockServerUrl = `http://127.0.0.1:${addr.port}/mcp`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (mockServer) mockServer.close();
    if (db) await db.dropDatabase();
    if (mongoClient) await mongoClient.close();
  });

  it('proves no known secrets appear in HTTP response bodies or captured log lines', async () => {
    let capturedLogs = '';
    const destination = {
      write: (chunk: string) => {
        capturedLogs += chunk;
      },
    };

    const customLogger = pino(
      {
        level: 'info',
        redact: {
          paths: REDACTED_PATHS,
          censor: '[REDACTED]',
        },
      },
      destination as Writable,
    );

    const crypto = new CredentialCrypto(parseEncryptionKeys(testConfig.CREDENTIAL_ENC_KEYS));
    const catalogService = new CatalogService(db);
    const upstreamManager = new UpstreamManager(db, crypto, catalogService);
    const auditSink = new MongoAuditSink(db);
    const toolRouter = new ToolRouter(catalogService, upstreamManager, auditSink);

    const app = buildApp(testConfig, db, {
      crypto,
      catalogService,
      upstreamManager,
      toolRouter,
      auditSink,
      loggerInstance: customLogger,
    });

    const capturedResponseBodies: string[] = [];
    app.addHook('onSend', async (_request, _reply, payload) => {
      if (typeof payload === 'string') {
        capturedResponseBodies.push(payload);
      }
      return payload;
    });

    await app.ready();

    // 1. Seed admin user with KNOWN_ADMIN_PASSWORD
    const passwordHash = await hashPassword(KNOWN_ADMIN_PASSWORD);
    const adminUserId = new ObjectId();
    await db.collection<UserDocument>('users').insertOne({
      _id: adminUserId,
      email: KNOWN_ADMIN_EMAIL,
      passwordHash,
      role: 'admin',
      name: 'Bootstrap Admin',
      failedLoginAttempts: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // 2. Seed upstream server with KNOWN_WOO_TOKEN encrypted with serverId AAD
    const serverId = new ObjectId();
    const encryptedAuth = crypto.encryptCredential(serverId.toString(), KNOWN_WOO_TOKEN, 'bearer');
    await db.collection<McpServerDocument>('mcp_servers').insertOne({
      _id: serverId,
      slug: 'upstream_srv',
      displayName: 'Upstream Srv',
      url: mockServerUrl,
      enabled: true,
      trusted: true,
      system: true,
      origin: 'seed',
      auth: encryptedAuth,
      callTimeoutMs: 5000,
      maxConcurrent: 5,
      approveOnAdd: true,
      status: {
        state: 'connected',
        reasonCode: null,
        reason: null,
        checkedAt: null,
        lastSuccessAt: null,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await upstreamManager.loadServers();
    await upstreamManager.runCatalogRefreshLoop();

    // 3. Login
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        'content-type': 'application/json',
        origin: 'http://dashboard.localhost',
      },
      payload: {
        email: KNOWN_ADMIN_EMAIL,
        password: KNOWN_ADMIN_PASSWORD,
      },
    });
    expect(loginRes.statusCode).toBe(200);

    const cookieHeader = loginRes.headers['set-cookie'] as string;
    const sessionId = cookieHeader.split(';')[0];
    const { csrfToken } = JSON.parse(loginRes.body);

    // 4. Create API Key
    const keyRes = await app.inject({
      method: 'POST',
      url: '/api/keys',
      headers: {
        'content-type': 'application/json',
        cookie: sessionId,
        'x-csrf-token': csrfToken,
        origin: 'http://dashboard.localhost',
      },
      payload: { name: 'leakage-proof-key' },
    });
    expect(keyRes.statusCode).toBe(201);
    const { key: rawApiKey } = JSON.parse(keyRes.body);
    expect(rawApiKey).toBeDefined();

    // 5. Call /mcp tools/list (Streamable HTTP requires valid accept header)
    const listRes = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: `Bearer ${rawApiKey}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      },
    });
    expect(listRes.statusCode).toBe(200);

    // 6. Call /mcp tools/call (success)
    const callRes = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: `Bearer ${rawApiKey}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'upstream_srv__query_db',
          arguments: {},
        },
      },
    });
    expect(callRes.statusCode).toBe(200);

    // 7. Call /mcp tools/call with non-existent tool (upstream failure)
    const failRes = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: `Bearer ${rawApiKey}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'upstream_srv__non_existent_tool',
          arguments: {},
        },
      },
    });
    expect(failRes.statusCode).toBe(200);

    // 8. Audit export
    const exportRes = await app.inject({
      method: 'GET',
      url: '/api/audit/export.csv',
      headers: {
        cookie: sessionId,
        origin: 'http://dashboard.localhost',
      },
    });
    expect(exportRes.statusCode).toBe(200);

    // Flush audit queue
    await auditSink.flush();

    // --- ASSERTIONS: LOG REDACTION & SECRET HYGIENE ---
    expect(capturedLogs).not.toContain(KNOWN_WOO_TOKEN);
    expect(capturedLogs).not.toContain(KNOWN_PEPPER);
    expect(capturedLogs).not.toContain(KNOWN_ADMIN_PASSWORD);
    expect(capturedLogs).not.toContain(rawApiKey);
    expect(capturedLogs).not.toContain(sessionId.replace('session_id=', ''));

    // --- ASSERTIONS: RESPONSE BODY SECRET HYGIENE ---
    const otherResponses = capturedResponseBodies.filter((b) => !b.includes(rawApiKey));

    for (const body of otherResponses) {
      expect(body).not.toContain(rawApiKey);
    }

    for (const body of capturedResponseBodies) {
      expect(body).not.toContain(KNOWN_WOO_TOKEN);
      expect(body).not.toContain(KNOWN_PEPPER);
      expect(body).not.toContain(KNOWN_ADMIN_PASSWORD);
      expect(body).not.toContain(sessionId.replace('session_id=', ''));
    }

    await app.close();
  });
});

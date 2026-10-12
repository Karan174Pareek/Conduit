import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoClient, Db } from 'mongodb';
import { runMigrations, getCurrentSchemaVersion, isSchemaReady } from '../src/db/migrations/runner.js';
import { bootstrapAdmin } from '../src/services/bootstrap.js';
import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import type { FastifyInstance } from 'fastify';

const TEST_MONGO_URI =
  process.env['TEST_MONGO_URI'] ||
  process.env['MONGO_URI'] ||
  'mongodb://root:rootpass@127.0.0.1:27017/conduit_test?authSource=admin';

describe('Gateway Integration Tests with Real MongoDB', { timeout: 30000 }, () => {
  let mongoClient: MongoClient;
  let db: Db;
  let app: FastifyInstance;

  const testConfig: Config = {
    PORT: 3000,
    HOST: '0.0.0.0',
    MONGO_URI: TEST_MONGO_URI,
    SESSION_SECRET: '0'.repeat(64),
    API_KEY_PEPPER: '1'.repeat(64),
    CREDENTIAL_ENC_KEYS: 'k1:MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
    BOOTSTRAP_ADMIN_EMAIL: 'admin@conduit.localhost',
    BOOTSTRAP_ADMIN_PASSWORD: 'secureAdminPassword123!',
    PUBLIC_DASHBOARD_URL: 'http://dashboard.localhost',
    PUBLIC_GATEWAY_URL: 'http://gateway.localhost',
    ALLOWED_ORIGINS: 'http://dashboard.localhost',
    LOG_LEVEL: 'warn',
    ENABLE_DEBUG_ROUTES: true,
    GEMINI_API_KEY: '',
    GEMINI_MODEL: 'gemini-2.5-flash',
  };

  beforeAll(async () => {
    mongoClient = new MongoClient(TEST_MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
    });
    await mongoClient.connect();
    db = mongoClient.db();

    // Clean test database before test suite
    await db.dropDatabase();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (mongoClient) {
      await mongoClient.close();
    }
  });

  it('runs migrations idempotently and creates collections and indexes', async () => {
    // Run migration 1st time
    await runMigrations(db, 'test-replica-1');
    const version1 = await getCurrentSchemaVersion(db);
    expect(version1).toBe(1);

    const isReady1 = await isSchemaReady(db);
    expect(isReady1).toBe(true);

    // Verify collections created
    const collections = await db.listCollections().toArray();
    const names = collections.map((c) => c.name);
    expect(names).toContain('users');
    expect(names).toContain('sessions');
    expect(names).toContain('api_keys');
    expect(names).toContain('mcp_servers');
    expect(names).toContain('tool_catalog');
    expect(names).toContain('tool_calls');
    expect(names).toContain('admin_events');
    expect(names).toContain('system_state');

    // Run migration 2nd time (must be idempotent and succeed without error)
    await runMigrations(db, 'test-replica-1');
    const version2 = await getCurrentSchemaVersion(db);
    expect(version2).toBe(1);
  });

  it('handles two concurrent startups with distributed lock', async () => {
    // Concurrently trigger migrations from two distinct holder IDs
    await Promise.all([
      runMigrations(db, 'concurrent-replica-A'),
      runMigrations(db, 'concurrent-replica-B'),
    ]);

    const finalVersion = await getCurrentSchemaVersion(db);
    expect(finalVersion).toBe(1);
  });

  it('bootstraps admin user idempotently without duplicates', async () => {
    // 1st bootstrap run
    await bootstrapAdmin(db, testConfig, 'bootstrap-1');
    const adminCount1 = await db.collection('users').countDocuments({ role: 'admin' });
    expect(adminCount1).toBe(1);

    // 2nd bootstrap run
    await bootstrapAdmin(db, testConfig, 'bootstrap-2');
    const adminCount2 = await db.collection('users').countDocuments({ role: 'admin' });
    expect(adminCount2).toBe(1);
  });

  it('serves /healthz and /readyz probes accurately', async () => {
    app = buildApp(testConfig, db);
    await app.ready();

    // GET /healthz
    const resHealth = await app.inject({
      method: 'GET',
      url: '/healthz',
    });
    expect(resHealth.statusCode).toBe(200);
    expect(resHealth.json()).toEqual({ status: 'ok' });

    // GET /readyz
    const resReady = await app.inject({
      method: 'GET',
      url: '/readyz',
    });
    expect(resReady.statusCode).toBe(200);
    expect(resReady.json()).toMatchObject({ status: 'ready', schemaVersion: 1 });
  });

  it('enforces login verification, cookie session creation, and lockout after 10 failures', async () => {
    // Correct login
    const resSuccess = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: testConfig.BOOTSTRAP_ADMIN_EMAIL,
        password: testConfig.BOOTSTRAP_ADMIN_PASSWORD,
      },
    });
    expect(resSuccess.statusCode).toBe(200);
    const bodySuccess = resSuccess.json();
    expect(bodySuccess.user.email).toBe(testConfig.BOOTSTRAP_ADMIN_EMAIL);
    expect(bodySuccess.csrfToken).toBeDefined();

    const cookies = resSuccess.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(String(cookies)).toContain('session_id=');

    // Create a separate test user for lockout testing
    const testMemberEmail = 'lockout-test@conduit.localhost';
    const { hashPassword } = await import('../src/services/password.js');
    const memberPassHash = await hashPassword('correctPassword123!');
    await db.collection('users').insertOne({
      email: testMemberEmail,
      role: 'member',
      passwordHash: memberPassHash,
      failedLoginAttempts: 0,
      lockedUntil: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // 9 consecutive failures
    for (let i = 1; i <= 9; i++) {
      const resFail = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: testMemberEmail,
          password: 'incorrectPassword!',
        },
      });
      expect(resFail.statusCode).toBe(401);
      expect(resFail.json().message).toBe('Invalid email or password');
    }

    // 10th failure triggers lockout
    const res10th = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: testMemberEmail,
        password: 'incorrectPassword!',
      },
    });
    expect(res10th.statusCode).toBe(401);

    // 11th attempt (even with correct password) returns 429 locked
    const resLocked = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: testMemberEmail,
        password: 'correctPassword123!',
      },
    });
    expect(resLocked.statusCode).toBe(429);
    expect(resLocked.json().code).toBe('rate_limited');
  });

  it('manages full API key lifecycle: create -> reveal -> authenticate -> revoke -> 401', async () => {
    // Login as bootstrap admin
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: testConfig.BOOTSTRAP_ADMIN_EMAIL,
        password: testConfig.BOOTSTRAP_ADMIN_PASSWORD,
      },
    });
    const sessionCookie = loginRes.cookies[0];
    const { csrfToken } = loginRes.json();

    // Create an API key
    const createKeyRes = await app.inject({
      method: 'POST',
      url: '/api/keys',
      headers: {
        cookie: `session_id=${sessionCookie?.value}`,
        'x-csrf-token': csrfToken,
        origin: 'http://dashboard.localhost',
      },
      payload: {
        name: 'Deployment Key',
      },
    });
    expect(createKeyRes.statusCode).toBe(201);
    const createdKey = createKeyRes.json();
    expect(createdKey.key).toBeDefined();
    expect(createdKey.key).toMatch(/^mcpgw_/);
    const rawApiKey = createdKey.key;
    const keyId = createdKey.id;

    // Use the Bearer API key to call authenticated /api/keys route
    const authRes = await app.inject({
      method: 'GET',
      url: '/api/keys',
      headers: {
        authorization: `Bearer ${rawApiKey}`,
      },
    });
    expect(authRes.statusCode).toBe(200);
    const authBody = authRes.json();
    expect(authBody.keys.some((k: { id: string }) => k.id === keyId)).toBe(true);

    // Revoke the API key
    const revokeRes = await app.inject({
      method: 'DELETE',
      url: `/api/keys/${keyId}`,
      headers: {
        cookie: `session_id=${sessionCookie?.value}`,
        'x-csrf-token': csrfToken,
        origin: 'http://dashboard.localhost',
      },
    });
    expect(revokeRes.statusCode).toBe(200);

    // Next request with revoked API key must immediately return 401
    const postRevokeRes = await app.inject({
      method: 'GET',
      url: '/api/keys',
      headers: {
        authorization: `Bearer ${rawApiKey}`,
      },
    });
    expect(postRevokeRes.statusCode).toBe(401);
  });

  it('enforces multi-tenant isolation: member cannot see or revoke another user keys, admin can revoke any', async () => {
    const { hashPassword } = await import('../src/services/password.js');
    const pwdHash = await hashPassword('password123!');

    // Create Member A and Member B
    const userA = await db.collection('users').insertOne({
      email: 'user-a@conduit.localhost',
      role: 'member',
      passwordHash: pwdHash,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const userB = await db.collection('users').insertOne({
      email: 'user-b@conduit.localhost',
      role: 'member',
      passwordHash: pwdHash,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const _userAId = userA.insertedId.toString();
    const _userBId = userB.insertedId.toString();

    // Login Member A
    const loginA = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'user-a@conduit.localhost', password: 'password123!' },
    });
    const cookieA = loginA.cookies[0]?.value;
    const csrfA = loginA.json().csrfToken;

    // Login Member B
    const loginB = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'user-b@conduit.localhost', password: 'password123!' },
    });
    const cookieB = loginB.cookies[0]?.value;
    const csrfB = loginB.json().csrfToken;

    // User A creates Key A
    const resKeyA = await app.inject({
      method: 'POST',
      url: '/api/keys',
      headers: {
        cookie: `session_id=${cookieA}`,
        'x-csrf-token': csrfA,
        origin: 'http://dashboard.localhost',
      },
      payload: { name: 'Key A' },
    });
    const keyAId = resKeyA.json().id;

    // User B creates Key B
    const resKeyB = await app.inject({
      method: 'POST',
      url: '/api/keys',
      headers: {
        cookie: `session_id=${cookieB}`,
        'x-csrf-token': csrfB,
        origin: 'http://dashboard.localhost',
      },
      payload: { name: 'Key B' },
    });
    const keyBId = resKeyB.json().id;

    // User A lists keys: sees only Key A
    const listA = await app.inject({
      method: 'GET',
      url: '/api/keys',
      headers: { cookie: `session_id=${cookieA}` },
    });
    const keysA = listA.json().keys;
    expect(keysA.some((k: any) => k.id === keyAId)).toBe(true);
    expect(keysA.some((k: any) => k.id === keyBId)).toBe(false);

    // User A attempts to revoke User B's key -> 403 Forbidden
    const revokeAttempt = await app.inject({
      method: 'DELETE',
      url: `/api/keys/${keyBId}`,
      headers: {
        cookie: `session_id=${cookieA}`,
        'x-csrf-token': csrfA,
        origin: 'http://dashboard.localhost',
      },
    });
    expect(revokeAttempt.statusCode).toBe(403);

    // Admin lists keys: sees both Key A and Key B
    const loginAdmin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: testConfig.BOOTSTRAP_ADMIN_EMAIL,
        password: testConfig.BOOTSTRAP_ADMIN_PASSWORD,
      },
    });
    const adminCookie = loginAdmin.cookies[0]?.value;
    const adminCsrf = loginAdmin.json().csrfToken;

    const listAdmin = await app.inject({
      method: 'GET',
      url: '/api/keys',
      headers: { cookie: `session_id=${adminCookie}` },
    });
    const adminKeys = listAdmin.json().keys;
    expect(adminKeys.some((k: any) => k.id === keyAId)).toBe(true);
    expect(adminKeys.some((k: any) => k.id === keyBId)).toBe(true);

    // Admin revokes Key B -> 200 OK
    const adminRevoke = await app.inject({
      method: 'DELETE',
      url: `/api/keys/${keyBId}`,
      headers: {
        cookie: `session_id=${adminCookie}`,
        'x-csrf-token': adminCsrf,
        origin: 'http://dashboard.localhost',
      },
    });
    expect(adminRevoke.statusCode).toBe(200);
  });
});

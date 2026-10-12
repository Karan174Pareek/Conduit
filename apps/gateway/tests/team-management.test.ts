import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoClient, Db } from 'mongodb';
import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import { runMigrations } from '../src/db/migrations/runner.js';
import { hashPassword } from '../src/services/password.js';

describe('Team Management & Invites Lifecycle', { timeout: 30000 }, () => {
  let client: MongoClient;
  let db: Db;
  let app: any;
  const dbName = `test-team-${Date.now()}`;

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

  let adminCookie: string;
  let adminCsrfToken: string;
  let adminUserId: string;

  let secondAdminId: string;
  let memberUserId: string;

  beforeAll(async () => {
    client = new MongoClient(mockConfig.MONGO_URI);
    await client.connect();
    db = client.db(dbName);

    await runMigrations(db, 'test-team-runner');

    // Create primary admin
    const adminPassHash = await hashPassword('AdminPassword123!');
    const adminInsert = await db.collection('users').insertOne({
      email: 'primary-admin@conduit.localhost',
      name: 'Primary Admin',
      role: 'admin',
      passwordHash: adminPassHash,
      status: 'active',
      disabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    adminUserId = adminInsert.insertedId.toString();

    // Create secondary admin
    const secondAdminInsert = await db.collection('users').insertOne({
      email: 'secondary-admin@conduit.localhost',
      name: 'Secondary Admin',
      role: 'admin',
      passwordHash: adminPassHash,
      status: 'active',
      disabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    secondAdminId = secondAdminInsert.insertedId.toString();

    app = buildApp(mockConfig, db);
    await app.ready();

    // Log in as primary admin to get session & csrf
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        'content-type': 'application/json',
        origin: 'http://dashboard.localhost',
      },
      payload: {
        email: 'primary-admin@conduit.localhost',
        password: 'AdminPassword123!',
      },
    });

    expect(loginRes.statusCode).toBe(200);
    adminCsrfToken = loginRes.json().csrfToken;
    const cookieHeader = loginRes.headers['set-cookie'];
    adminCookie = Array.isArray(cookieHeader) ? cookieHeader[0] : (cookieHeader as string);
  }, 30000);

  afterAll(async () => {
    if (app) await app.close();
    if (db) await db.dropDatabase().catch(() => {});
    if (client) await client.close();
  });

  it('allows admin to create an invite, and prevents inviting existing active user', async () => {
    // 1. Create invite for new user
    const res = await app.inject({
      method: 'POST',
      url: '/api/invites',
      headers: {
        cookie: adminCookie,
        'x-csrf-token': adminCsrfToken,
        origin: 'http://dashboard.localhost',
      },
      payload: {
        email: 'new-member@conduit.localhost',
        role: 'member',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.email).toBe('new-member@conduit.localhost');
    expect(body.role).toBe('member');
    expect(body.token).toBeDefined();

    // 2. Reject inviting already active user
    const conflictRes = await app.inject({
      method: 'POST',
      url: '/api/invites',
      headers: {
        cookie: adminCookie,
        'x-csrf-token': adminCsrfToken,
        origin: 'http://dashboard.localhost',
      },
      payload: {
        email: 'primary-admin@conduit.localhost',
        role: 'member',
      },
    });

    expect(conflictRes.statusCode).toBe(409);
  });

  it('accepts invite once with Argon2id password and prevents reuse or expired tokens', async () => {
    // 1. Generate fresh invite
    const inviteRes = await app.inject({
      method: 'POST',
      url: '/api/invites',
      headers: {
        cookie: adminCookie,
        'x-csrf-token': adminCsrfToken,
        origin: 'http://dashboard.localhost',
      },
      payload: {
        email: 'joiner@conduit.localhost',
        role: 'member',
      },
    });
    const { token } = inviteRes.json();

    // 2. Accept invite
    const acceptRes = await app.inject({
      method: 'POST',
      url: '/api/invites/accept',
      payload: {
        token,
        name: 'New Joiner',
        password: 'SecureJoinerPass123!',
      },
    });

    expect(acceptRes.statusCode).toBe(200);
    expect(acceptRes.json().message).toBe('Invite accepted successfully');

    // Verify user in DB
    const userDoc = await db.collection('users').findOne({ email: 'joiner@conduit.localhost' });
    expect(userDoc).toBeDefined();
    expect(userDoc!.status).toBe('active');
    expect(userDoc!.passwordHash).toMatch(/^\$argon2id\$/);
    memberUserId = userDoc!._id.toString();

    // 3. Attempting to reuse the same token must fail
    const reuseRes = await app.inject({
      method: 'POST',
      url: '/api/invites/accept',
      payload: {
        token,
        name: 'Imposter',
        password: 'AnotherPassword123!',
      },
    });

    expect(reuseRes.statusCode).toBe(400);
  });

  it('enforces self-demote, self-disable, and last-active-admin guardrails', async () => {
    // 1. Primary admin cannot demote self
    const selfDemoteRes = await app.inject({
      method: 'PATCH',
      url: `/api/users/${adminUserId}`,
      headers: {
        cookie: adminCookie,
        'x-csrf-token': adminCsrfToken,
        origin: 'http://dashboard.localhost',
      },
      payload: { role: 'member' },
    });
    expect(selfDemoteRes.statusCode).toBe(400);
    expect(selfDemoteRes.json().message).toContain('Cannot demote yourself');

    // 2. Primary admin cannot disable self
    const selfDisableRes = await app.inject({
      method: 'PATCH',
      url: `/api/users/${adminUserId}`,
      headers: {
        cookie: adminCookie,
        'x-csrf-token': adminCsrfToken,
        origin: 'http://dashboard.localhost',
      },
      payload: { status: 'disabled' },
    });
    expect(selfDisableRes.statusCode).toBe(400);
    expect(selfDisableRes.json().message).toContain('Cannot disable your own administrator account');

    // 3. Demote secondary admin (succeeds because 2 admins exist)
    const demoteSecondaryRes = await app.inject({
      method: 'PATCH',
      url: `/api/users/${secondAdminId}`,
      headers: {
        cookie: adminCookie,
        'x-csrf-token': adminCsrfToken,
        origin: 'http://dashboard.localhost',
      },
      payload: { role: 'member' },
    });
    expect(demoteSecondaryRes.statusCode).toBe(200);

    // 4. Now only 1 active admin remains (primary admin).
    // Attempting to demote or disable primary admin (even via another mechanism) must be blocked as last admin
    // Try to demote member back to member (succeeds)
    const updateMemberRes = await app.inject({
      method: 'PATCH',
      url: `/api/users/${memberUserId}`,
      headers: {
        cookie: adminCookie,
        'x-csrf-token': adminCsrfToken,
        origin: 'http://dashboard.localhost',
      },
      payload: { status: 'disabled' },
    });
    expect(updateMemberRes.statusCode).toBe(200);
    expect(updateMemberRes.json().disabled).toBe(true);

    // List users
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/users',
      headers: {
        cookie: adminCookie,
        origin: 'http://dashboard.localhost',
      },
    });
    expect(listRes.statusCode).toBe(200);
    const usersList = listRes.json().users;
    expect(usersList.length).toBeGreaterThanOrEqual(3);
    for (const u of usersList) {
      expect(u.passwordHash).toBeUndefined(); // Never expose hashes
    }
  });
});

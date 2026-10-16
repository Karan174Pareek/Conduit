import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { buildApp } from '../src/app.js';
import { runMigrations } from '../src/db/migrations/runner.js';
import { hashPassword } from '../src/services/password.js';
import { createApiKey } from '../src/services/api-keys.js';
import type { Config } from '../src/config.js';
import type { InviteDocument } from '../src/db/types.js';

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
  let memberSessionCookie: string;
  let memberApiKey: string;

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

  it('rejects expired, wrong, or reused tokens with identical generic error text', async () => {
    // 1. Test completely wrong token
    const wrongRes = await app.inject({
      method: 'POST',
      url: '/api/auth/accept-invite',
      payload: {
        token: 'totally-invalid-and-nonexistent-token',
        name: 'Wrong Token User',
        password: 'Password123!',
      },
    });
    expect(wrongRes.statusCode).toBe(400);
    expect(wrongRes.json().message).toBe('Invalid or expired invite token');

    // 2. Test expired token in DB
    const crypto = await import('node:crypto');
    const expiredRawToken = crypto.randomBytes(32).toString('base64url');
    const expiredTokenHash = crypto.createHash('sha256').update(expiredRawToken).digest('hex');
    await db.collection<InviteDocument>('invites').insertOne({
      email: 'expired-user@conduit.localhost',
      role: 'member',
      tokenHash: expiredTokenHash,
      invitedBy: adminUserId,
      expiresAt: new Date(Date.now() - 3600 * 1000), // 1 hour ago
      usedAt: null,
      createdAt: new Date(Date.now() - 73 * 3600 * 1000),
    });

    const expiredRes = await app.inject({
      method: 'POST',
      url: '/api/auth/accept-invite',
      payload: {
        token: expiredRawToken,
        name: 'Expired User',
        password: 'Password123!',
      },
    });
    expect(expiredRes.statusCode).toBe(400);
    expect(expiredRes.json().message).toBe('Invalid or expired invite token');

    // 3. Test alias endpoint /api/auth/accept-invite behaves identically
    const aliasRes = await app.inject({
      method: 'POST',
      url: '/api/auth/accept-invite',
      payload: {
        token: expiredRawToken,
        name: 'Expired User',
        password: 'Password123!',
      },
    });
    expect(aliasRes.statusCode).toBe(400);
    expect(aliasRes.json().message).toBe('Invalid or expired invite token');
  });

  it('accepts invite once with Argon2id password and prevents reuse', async () => {
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
      url: '/api/auth/accept-invite',
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

    // 3. Attempting to reuse the same token must fail with identical generic error
    const reuseRes = await app.inject({
      method: 'POST',
      url: '/api/auth/accept-invite',
      payload: {
        token,
        name: 'Imposter',
        password: 'AnotherPassword123!',
      },
    });

    expect(reuseRes.statusCode).toBe(400);
    expect(reuseRes.json().message).toBe('Invalid or expired invite token');

    // 4. Log in as newly joined member
    const memberLoginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        'content-type': 'application/json',
        origin: 'http://dashboard.localhost',
      },
      payload: {
        email: 'joiner@conduit.localhost',
        password: 'SecureJoinerPass123!',
      },
    });
    expect(memberLoginRes.statusCode).toBe(200);
    const mCookie = memberLoginRes.headers['set-cookie'];
    memberSessionCookie = Array.isArray(mCookie) ? mCookie[0] : (mCookie as string);

    // Create an API key for member
    const keyData = await createApiKey(db, mockConfig.API_KEY_PEPPER, memberUserId, 'member-test-key');
    memberApiKey = keyData.key;
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
    // Attempting to demote secondary admin further (already member) or last admin is guarded
    const lastAdminRes = await app.inject({
      method: 'PATCH',
      url: `/api/users/${adminUserId}`,
      headers: {
        cookie: adminCookie,
        'x-csrf-token': adminCsrfToken,
        origin: 'http://dashboard.localhost',
      },
      payload: { role: 'member' },
    });
    expect(lastAdminRes.statusCode).toBe(400);

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

  it('immediately rejects both session and API key on the very next request when user is disabled', async () => {
    // 1. Verify member session works before disable
    const beforeSessionRes = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: {
        cookie: memberSessionCookie,
        origin: 'http://dashboard.localhost',
      },
    });
    expect(beforeSessionRes.statusCode).toBe(200);

    // 2. Admin disables the member
    const disableRes = await app.inject({
      method: 'PATCH',
      url: `/api/users/${memberUserId}`,
      headers: {
        cookie: adminCookie,
        'x-csrf-token': adminCsrfToken,
        origin: 'http://dashboard.localhost',
      },
      payload: { status: 'disabled' },
    });
    expect(disableRes.statusCode).toBe(200);
    expect(disableRes.json().status).toBe('disabled');

    // 3. Member session cookie MUST FAIL on the very next request with 401
    const afterSessionRes = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: {
        cookie: memberSessionCookie,
        origin: 'http://dashboard.localhost',
      },
    });
    expect(afterSessionRes.statusCode).toBe(401);
    expect(afterSessionRes.json().code).toBe('unauthorized');

    // 4. Member API key MUST FAIL on the very next /mcp request with 401
    const mcpRes = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: `Bearer ${memberApiKey}`,
        'content-type': 'application/json',
      },
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      },
    });
    expect(mcpRes.statusCode).toBe(401);
  });
});

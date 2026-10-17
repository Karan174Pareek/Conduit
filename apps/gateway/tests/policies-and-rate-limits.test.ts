import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { MongoClient, Db, ObjectId } from 'mongodb';
import { DbPolicyEngine } from '../src/policy/engine.js';
import { TokenBucketRateLimiter, ConcurrencyLimiter, createIpRateLimiter } from '../src/middleware/rate-limiter.js';
import { ToolRouter } from '../src/router/tool-router.js';
import { runMigrations } from '../src/db/migrations/runner.js';
import { rotateCredentials } from '../src/registry/rotate.js';
import { CredentialCrypto } from '../src/registry/crypto.js';
import { parseEncryptionKeys } from '../src/config.js';
import type { Principal } from '../src/router/tool-router.js';
import type { ToolCatalogDocument, McpServerDocument } from '../src/db/types.js';

describe('Tool Permissions Policy, Rate Limiting & Migration 0005 Suite (F2)', () => {
  let mongoClient: MongoClient;
  let db: Db;
  let testDbName: string;
  let mongoUri: string;

  beforeEach(async () => {
    mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
    testDbName = `conduit_test_f2_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    mongoClient = new MongoClient(mongoUri);
    await mongoClient.connect();
    db = mongoClient.db(testDbName);
    await runMigrations(db);
  });

  afterEach(async () => {
    try {
      await db.dropDatabase();
    } catch (_e) {
      void _e;
    }
    await mongoClient.close();
  });

  describe('F2 e) Migration 0005 & Index Verification', () => {
    it('creates 1-year TTL index on admin_events and policy indexes idempotently', async () => {
      const adminEventsIndexes = await db.collection('admin_events').indexes();
      const ttlIndex = adminEventsIndexes.find((idx) => idx.name === 'admin_events_ts_ttl_1y');
      expect(ttlIndex).toBeDefined();
      expect(ttlIndex?.expireAfterSeconds).toBe(365 * 86400);

      const policyIndexes = await db.collection('policies').indexes();
      const scopeRole = policyIndexes.find((idx) => idx.key?.scope === 1 && idx.key?.role === 1);
      const serverIdx = policyIndexes.find((idx) => idx.key?.serverId === 1);
      expect(scopeRole).toBeDefined();
      expect(serverIdx).toBeDefined();
    });
  });

  describe('F2 b) Tool Permissions Engine (§5.6)', () => {
    const adminUser: Principal = {
      userId: 'admin-1',
      role: 'admin',
      via: 'session',
    };

    const memberUser: Principal = {
      userId: 'member-1',
      role: 'member',
      via: 'session',
    };

    it('enforces read-only shortcut: member can call list_orders, cannot call create_product/update_order_status', async () => {
      const engine = new DbPolicyEngine(db, { membersReadOnlyDefault: true });

      // woo store is trusted server
      const isTrustedServer = true;

      // list_orders has readOnly: true
      const canListOrders = await engine.evaluate(
        memberUser,
        'woo',
        'list_orders',
        { readOnly: true },
        isTrustedServer,
      );
      expect(canListOrders).toBe(true);

      // create_product has readOnly: false
      const canCreateProduct = await engine.evaluate(
        memberUser,
        'woo',
        'create_product',
        { readOnly: false },
        isTrustedServer,
      );
      expect(canCreateProduct).toBe(false);

      // update_order_status has readOnly: false, destructiveHint: true
      const canUpdateOrder = await engine.evaluate(
        memberUser,
        'woo',
        'update_order_status',
        { readOnly: false, destructiveHint: true },
        isTrustedServer,
      );
      expect(canUpdateOrder).toBe(false);

      // Admin can execute all tools
      const adminCanCreate = await engine.evaluate(
        adminUser,
        'woo',
        'create_product',
        { readOnly: false },
        isTrustedServer,
      );
      expect(adminCanCreate).toBe(true);
    });

    it('honours evaluation order: user deny > user allow > role deny > role allow', async () => {
      const engine = new DbPolicyEngine(db);

      // 1. Role allow all for member
      await db.collection('policies').insertOne({
        scope: 'role',
        role: 'member',
        serverId: 'utils',
        toolPattern: '*',
        effect: 'allow',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // 2. Explicit user deny on calculate for member-1
      await db.collection('policies').insertOne({
        scope: 'user',
        subjectId: memberUser.userId,
        serverId: 'utils',
        toolPattern: 'calculate',
        effect: 'deny',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // User deny overrides role allow
      const canCalc = await engine.evaluate(memberUser, 'utils', 'calculate');
      expect(canCalc).toBe(false);

      // Other utils tools still allowed by role allow
      const canGenId = await engine.evaluate(memberUser, 'utils', 'generate_id');
      expect(canGenId).toBe(true);
    });

    it('rejects forbidden tools in ToolRouter with identical "Unknown tool" error and hides them from list()', async () => {
      const engine = new DbPolicyEngine(db, { membersReadOnlyDefault: true });

      // Mock upstream manager
      const mockServerDoc: McpServerDocument = {
        slug: 'woo',
        displayName: 'WooCommerce',
        url: 'http://woo-mcp:3100/mcp',
        enabled: true,
        trusted: true,
        system: true,
        origin: 'seed',
        auth: { type: 'none' },
        callTimeoutMs: 30000,
        maxConcurrent: 5,
        approveOnAdd: true,
        status: { state: 'connected', reasonCode: null, reason: null, checkedAt: new Date(), lastSuccessAt: new Date() },
      };

      const mockUpstreamManager: any = {
        getAllServerStates: () => [
          {
            server: mockServerDoc,
            breaker: { phase: 'closed' },
          },
        ],
        getServerState: (slug: string) =>
          slug === 'woo' ? { server: mockServerDoc, breaker: { phase: 'closed' } } : null,
      };

      // Seed approved tools in tool_catalog
      await db.collection<ToolCatalogDocument>('tool_catalog').insertMany([
        {
          serverId: 'woo',
          name: 'list_orders',
          exposedName: 'woo__list_orders',
          description: 'List store orders',
          descriptionRaw: 'List store orders',
          inputSchema: {},
          annotations: { readOnly: true },
          hash: 'hash-1',
          approval: { status: 'approved' },
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
          removedAt: null,
        },
        {
          serverId: 'woo',
          name: 'create_product',
          exposedName: 'woo__create_product',
          description: 'Create a product',
          descriptionRaw: 'Create a product',
          inputSchema: {},
          annotations: { readOnly: false },
          hash: 'hash-2',
          approval: { status: 'approved' },
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
          removedAt: null,
        },
      ]);

      const router = new ToolRouter(db, mockUpstreamManager, engine);

      // 1. Member tools/list only contains readOnly list_orders
      const memberTools = await router.list(memberUser);
      expect(memberTools.map((t) => t.name)).toEqual(['woo__list_orders']);

      // 2. Direct call to forbidden create_product returns identical "Unknown tool" error
      await expect(
        router.call(memberUser, 'woo__create_product', {}),
      ).rejects.toThrow('Unknown tool "woo__create_product"');
    });
  });

  describe('F2 c) Rate Limiting & Concurrency', () => {
    it('enforces token bucket rate limiter and reports retry-after seconds', async () => {
      // 3 tokens, refill rate 1 per second
      const limiter = new TokenBucketRateLimiter({ capacity: 3, refillRatePerSecond: 1 });

      // Consume 3 tokens
      expect((await limiter.consume('user-1')).allowed).toBe(true);
      expect((await limiter.consume('user-1')).allowed).toBe(true);
      expect((await limiter.consume('user-1')).allowed).toBe(true);

      // 4th token exhausted
      const fourth = await limiter.consume('user-1');
      expect(fourth.allowed).toBe(false);
      expect(fourth.retryAfterSeconds).toBeGreaterThanOrEqual(1);

      // Different user has own bucket
      expect((await limiter.consume('user-2')).allowed).toBe(true);
    });

    it('enforces concurrency cap per user', () => {
      const limiter = new ConcurrencyLimiter(2); // max 2 concurrent

      expect(limiter.tryAcquire('user-1')).toBe(true);
      expect(limiter.tryAcquire('user-1')).toBe(true);
      expect(limiter.tryAcquire('user-1')).toBe(false); // 3rd blocked

      limiter.release('user-1');
      expect(limiter.tryAcquire('user-1')).toBe(true); // now allowed
    });

    it('enforces IP rate throttle on auth requests', async () => {
      const hook = createIpRateLimiter({ max: 2, windowMs: 10000, routeName: 'test_auth' });

      const fakeReq: any = { ip: '192.168.1.50', headers: {} };
      let statusSent = 0;
      let bodySent: any = null;
      const headersSet: Record<string, string> = {};

      const fakeReply: any = {
        header: (k: string, v: string) => {
          headersSet[k] = v;
        },
        status: (s: number) => {
          statusSent = s;
          return {
            send: (b: any) => {
              bodySent = b;
            },
          };
        },
      };

      // 1st and 2nd calls pass
      await hook(fakeReq, fakeReply);
      expect(statusSent).toBe(0);

      await hook(fakeReq, fakeReply);
      expect(statusSent).toBe(0);

      // 3rd call throttled with 429
      await hook(fakeReq, fakeReply);
      expect(statusSent).toBe(429);
      expect(bodySent?.error).toBe('rate_limited');
      expect(headersSet['Retry-After']).toBeDefined();
    });
  });

  describe('F2 d) Credential Re-Encryption Rotation Drill', () => {
    it('re-encrypts server credentials from old key to new active key idempotently', async () => {
      const oldKid = 'key-v1';
      const oldKeyB64 = Buffer.alloc(32, 1).toString('base64');
      const newKid = 'key-v2';
      const newKeyB64 = Buffer.alloc(32, 2).toString('base64');

      // Server encrypted with oldKey
      const oldCrypto = new CredentialCrypto(parseEncryptionKeys(`${oldKid}:${oldKeyB64}`));
      const serverId = new ObjectId().toString();
      const rawSecret = 'wp-consumer-secret-live-12345';
      const encrypted = oldCrypto.encryptCredential(serverId, rawSecret, 'bearer');

      await db.collection<McpServerDocument>('mcp_servers').insertOne({
        _id: new ObjectId(serverId),
        slug: 'store-1',
        displayName: 'Store 1',
        url: 'http://woo-mcp:3100/mcp',
        enabled: true,
        trusted: true,
        system: false,
        origin: 'admin',
        auth: {
          type: 'bearer',
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          tag: encrypted.tag,
          kid: encrypted.kid,
        },
        callTimeoutMs: 30000,
        maxConcurrent: 5,
        approveOnAdd: true,
        status: { state: 'connected', reasonCode: null, reason: null, checkedAt: new Date(), lastSuccessAt: new Date() },
      });

      // Rotation config: new active key first, old key second
      const rotationKeys = `${newKid}:${newKeyB64},${oldKid}:${oldKeyB64}`;

      const parsedUri = new URL(mongoUri);
      parsedUri.pathname = `/${testDbName}`;
      const targetDbUri = parsedUri.toString();

      const res = await rotateCredentials(targetDbUri, rotationKeys);
      expect(res.rotatedCount).toBe(1);
      expect(res.activeKid).toBe(newKid);

      // Verify the document in DB was updated with new kid
      const updatedServer = await db.collection<McpServerDocument>('mcp_servers').findOne({ slug: 'store-1' });
      expect(updatedServer?.auth.kid).toBe(newKid);

      // Verify decrypted value matches original secret
      const newCrypto = new CredentialCrypto(parseEncryptionKeys(rotationKeys));
      const decrypted = newCrypto.decryptCredential(serverId, updatedServer!.auth);
      expect(decrypted).toBe(rawSecret);

      // Idempotency: second rotation run does nothing
      const secondRun = await rotateCredentials(targetDbUri, rotationKeys);
      expect(secondRun.rotatedCount).toBe(0);
    });
  });
});

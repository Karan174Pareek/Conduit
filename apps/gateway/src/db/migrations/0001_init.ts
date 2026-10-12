import type { Db } from 'mongodb';

export const version = 1;
export const name = '0001_init';

export async function up(db: Db): Promise<void> {
  // 1. users
  await db.createCollection('users').catch(() => {});
  await db.collection('users').createIndex({ email: 1 }, { unique: true });

  // 2. sessions
  await db.createCollection('sessions').catch(() => {});
  await db.collection('sessions').createIndex({ tokenHash: 1 }, { unique: true });
  await db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

  // 3. api_keys
  await db.createCollection('api_keys').catch(() => {});
  await db.collection('api_keys').createIndex({ prefix: 1 });
  await db.collection('api_keys').createIndex({ keyHash: 1 }, { unique: true });
  await db.collection('api_keys').createIndex({ ownerId: 1, revokedAt: 1 });

  // 4. mcp_servers
  await db.createCollection('mcp_servers').catch(() => {});
  await db.collection('mcp_servers').createIndex({ slug: 1 }, { unique: true });
  await db.collection('mcp_servers').createIndex({ enabled: 1 });

  // 5. tool_catalog
  await db.createCollection('tool_catalog').catch(() => {});
  await db.collection('tool_catalog').createIndex(
    { serverId: 1, name: 1 },
    { unique: true },
  );
  await db.collection('tool_catalog').createIndex({ exposedName: 1 }, { unique: true });
  await db.collection('tool_catalog').createIndex({ 'approval.status': 1 });

  // 6. tool_calls (90-day retention TTL)
  await db.createCollection('tool_calls').catch(() => {});
  await db.collection('tool_calls').createIndex({ ts: -1 });
  await db.collection('tool_calls').createIndex({ userId: 1, ts: -1 });
  await db.collection('tool_calls').createIndex({ serverSlug: 1, ts: -1 });
  await db.collection('tool_calls').createIndex(
    { createdAt: 1 },
    { expireAfterSeconds: 90 * 86400 },
  );

  // 7. admin_events
  await db.createCollection('admin_events').catch(() => {});
  await db.collection('admin_events').createIndex({ ts: -1 });
  await db.collection('admin_events').createIndex({ actorId: 1, ts: -1 });
  await db.collection('admin_events').createIndex({ action: 1, ts: -1 });

  // 8. system_state
  await db.createCollection('system_state').catch(() => {});

  // Initialize configVersion if not set
  await db.collection<{ _id: string; configVersion: number; updatedAt: Date }>('system_state').updateOne(
    { _id: 'config' },
    {
      $setOnInsert: {
        configVersion: 1,
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
}

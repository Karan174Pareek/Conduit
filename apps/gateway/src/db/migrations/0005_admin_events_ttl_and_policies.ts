import type { Db } from 'mongodb';

export const version = 5;
export const name = '0005_admin_events_ttl_and_policies';

export async function up(db: Db): Promise<void> {
  const adminEvents = db.collection('admin_events');
  const policies = db.collection('policies');

  // 1. admin_events TTL 1 year (365 * 86400 = 31536000 seconds)
  // Ensure idempotent creation even if an index already exists
  try {
    await adminEvents.createIndex(
      { ts: 1 },
      { expireAfterSeconds: 365 * 86400, name: 'admin_events_ts_ttl_1y' },
    );
  } catch (err: unknown) {
    const mongoErr = err as { code?: number };
    // Code 85: IndexOptionsConflict (drop and recreate with TTL)
    if (mongoErr.code === 85) {
      await adminEvents.dropIndex('admin_events_ts_ttl_1y').catch(() => {});
      await adminEvents.createIndex(
        { ts: 1 },
        { expireAfterSeconds: 365 * 86400, name: 'admin_events_ts_ttl_1y' },
      );
    }
  }

  // 2. policies indexes
  await policies.createIndex({ scope: 1, role: 1 });
  await policies.createIndex({ scope: 1, subjectId: 1 });
  await policies.createIndex({ serverId: 1 });
  await policies.createIndex({ createdAt: -1 });
}

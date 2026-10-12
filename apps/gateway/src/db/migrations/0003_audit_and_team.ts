import type { Db } from 'mongodb';

export const version = 3;
export const name = '0003_audit_and_team';

export async function up(db: Db): Promise<void> {
  const toolCalls = db.collection('tool_calls');
  const invites = db.collection('invites');
  const adminEvents = db.collection('admin_events');
  const users = db.collection('users');

  // 1. tool_calls indexes
  await toolCalls.createIndex({ ts: -1 });
  await toolCalls.createIndex({ userId: 1, ts: -1 });
  await toolCalls.createIndex({ serverSlug: 1, ts: -1 });
  await toolCalls.createIndex({ outcome: 1, ts: -1 });
  // TTL: 90 days retention
  await toolCalls.createIndex({ ts: 1 }, { expireAfterSeconds: 90 * 86400 });

  // 2. invites indexes
  await invites.createIndex({ tokenHash: 1 }, { unique: true });
  await invites.createIndex({ email: 1 });
  // TTL on expiresAt: cleaned up 7 days after expiry
  await invites.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 7 * 86400 });

  // 3. admin_events indexes
  await adminEvents.createIndex({ ts: -1 });
  await adminEvents.createIndex({ actorId: 1, ts: -1 });
  await adminEvents.createIndex({ action: 1, ts: -1 });

  // 4. users index for status filtering
  await users.createIndex({ status: 1 });
}

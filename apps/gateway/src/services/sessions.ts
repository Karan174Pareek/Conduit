import crypto from 'node:crypto';
import type { Db } from 'mongodb';
import { toObjectId, type SessionDocument, type UserDocument } from '../db/types.js';

export const IDLE_TIMEOUT_MS = 8 * 60 * 60 * 1000; // 8 hours sliding
export const ABSOLUTE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000; // 7 days absolute

export { type SessionDocument } from '../db/types.js';

export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export async function createSession(
  db: Db,
  userId: string,
): Promise<{ sessionId: string; csrfToken: string; expiresAt: Date }> {
  const sessionId = generateSessionToken();
  const tokenHash = hashSessionToken(sessionId);
  const csrfToken = generateCsrfToken();
  const now = new Date();
  const idleExpiresAt = new Date(now.getTime() + IDLE_TIMEOUT_MS);
  const absoluteExpiresAt = new Date(now.getTime() + ABSOLUTE_TIMEOUT_MS);
  const expiresAt = idleExpiresAt.getTime() < absoluteExpiresAt.getTime() ? idleExpiresAt : absoluteExpiresAt;

  const sessionDoc: SessionDocument = {
    tokenHash,
    userId,
    csrfToken,
    createdAt: now,
    idleExpiresAt,
    absoluteExpiresAt,
    expiresAt,
  };

  await db.collection<SessionDocument>('sessions').insertOne(sessionDoc);

  return { sessionId, csrfToken, expiresAt };
}

export async function getSessionAndTouch(
  db: Db,
  sessionId: string,
): Promise<{ session: SessionDocument; user: UserDocument } | null> {
  const tokenHash = hashSessionToken(sessionId);
  const session = await db.collection<SessionDocument>('sessions').findOne({ tokenHash });

  if (!session) {
    return null;
  }

  const now = new Date();
  if (now > session.expiresAt) {
    await db.collection<SessionDocument>('sessions').deleteOne({ tokenHash });
    return null;
  }

  // Find user
  const objId = toObjectId(session.userId);
  if (!objId) {
    return null;
  }

  const user = await db.collection<UserDocument>('users').findOne({ _id: objId });
  if (!user || user.disabled) {
    return null;
  }

  // Slide idle expiration up to absolute expiration
  const newIdle = new Date(now.getTime() + IDLE_TIMEOUT_MS);
  const newExpiresAt = newIdle.getTime() < session.absoluteExpiresAt.getTime() ? newIdle : session.absoluteExpiresAt;

  await db.collection<SessionDocument>('sessions').updateOne(
    { tokenHash },
    {
      $set: {
        idleExpiresAt: newIdle,
        expiresAt: newExpiresAt,
      },
    },
  );

  return { session, user };
}

export async function destroySession(db: Db, sessionId: string): Promise<void> {
  const tokenHash = hashSessionToken(sessionId);
  await db.collection<SessionDocument>('sessions').deleteOne({ tokenHash });
}

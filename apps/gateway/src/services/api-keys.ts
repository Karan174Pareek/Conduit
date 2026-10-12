import crypto from 'node:crypto';
import type { Db, Filter } from 'mongodb';
import { toObjectId, type ApiKeyDocument, type UserDocument } from '../db/types.js';

export const MAX_KEYS_PER_USER = 5;

export { type ApiKeyDocument } from '../db/types.js';

export interface GeneratedKeyResult {
  id: string;
  name: string;
  prefix: string;
  last4: string;
  key: string; // The plaintext secret key, shown ONCE
  createdAt: Date;
}

export function generateApiKeyParts(): { prefix: string; secret: string; fullKey: string; last4: string } {
  // 8 alphanumeric characters for prefix
  const prefix = crypto.randomBytes(4).toString('hex'); // 8 hex chars
  const secret = crypto.randomBytes(32).toString('base64url'); // 32 random bytes
  const fullKey = `mcpgw_${prefix}_${secret}`;
  const last4 = secret.slice(-4);
  return { prefix, secret, fullKey, last4 };
}

export function hashApiKey(pepper: string, fullKey: string): string {
  return crypto.createHmac('sha256', pepper).update(fullKey).digest('hex');
}

export async function createApiKey(
  db: Db,
  pepper: string,
  ownerId: string,
  name: string,
  expiresAt: Date | null = null,
): Promise<GeneratedKeyResult> {
  const activeCount = await db.collection<ApiKeyDocument>('api_keys').countDocuments({
    ownerId,
    revokedAt: null,
  });

  if (activeCount >= MAX_KEYS_PER_USER) {
    throw new Error(`Maximum of ${MAX_KEYS_PER_USER} active API keys allowed per user`);
  }

  const { prefix, fullKey, last4 } = generateApiKeyParts();
  const keyHash = hashApiKey(pepper, fullKey);
  const now = new Date();

  const doc: ApiKeyDocument = {
    prefix,
    keyHash,
    last4,
    name,
    ownerId,
    createdAt: now,
    revokedAt: null,
    expiresAt,
  };

  const insertResult = await db.collection<ApiKeyDocument>('api_keys').insertOne(doc);
  const id = insertResult.insertedId.toString();

  return {
    id,
    name,
    prefix,
    last4,
    key: fullKey,
    createdAt: now,
  };
}

export async function verifyApiKey(
  db: Db,
  pepper: string,
  rawKey: string,
): Promise<{ key: ApiKeyDocument; user: UserDocument } | null> {
  const match = /^mcpgw_([A-Za-z0-9]{8})_([A-Za-z0-9_-]+)$/.exec(rawKey);

  // If format doesn't match, run dummy HMAC for constant timing
  if (!match) {
    runDummyHmac(pepper, rawKey);
    return null;
  }

  const prefix = match[1];
  if (!prefix) {
    runDummyHmac(pepper, rawKey);
    return null;
  }

  const keyDoc = await db.collection<ApiKeyDocument>('api_keys').findOne({ prefix });

  if (!keyDoc) {
    runDummyHmac(pepper, rawKey);
    return null;
  }

  const computedHash = hashApiKey(pepper, rawKey);
  const hashBuffer = Buffer.from(computedHash, 'hex');
  const storedBuffer = Buffer.from(keyDoc.keyHash, 'hex');

  if (hashBuffer.length !== storedBuffer.length || !crypto.timingSafeEqual(hashBuffer, storedBuffer)) {
    return null;
  }

  // Check revocation and expiration
  const now = new Date();
  if (keyDoc.revokedAt !== null) {
    return null;
  }

  if (keyDoc.expiresAt !== null && keyDoc.expiresAt < now) {
    return null;
  }

  // Lookup user and check active status
  const ownerObjId = toObjectId(keyDoc.ownerId);
  if (!ownerObjId) {
    return null;
  }

  const user = await db.collection<UserDocument>('users').findOne({ _id: ownerObjId });
  if (!user || user.disabled) {
    return null;
  }

  return { key: keyDoc, user };
}

function runDummyHmac(pepper: string, input: string): void {
  const dummyComputed = hashApiKey(pepper, input);
  const dummyTarget = hashApiKey(pepper, 'dummy_target_for_timing_safe_compare');
  try {
    crypto.timingSafeEqual(Buffer.from(dummyComputed, 'hex'), Buffer.from(dummyTarget, 'hex'));
  } catch {
    // Length mismatch or compare error, ignore
  }
}

export async function listApiKeys(
  db: Db,
  userId: string,
  isAdmin: boolean,
): Promise<Array<Omit<ApiKeyDocument, 'keyHash'> & { id: string }>> {
  const query = isAdmin ? {} : { ownerId: userId };
  const keys = await db.collection<ApiKeyDocument>('api_keys').find(query).sort({ createdAt: -1 }).toArray();

  return keys.map((k) => ({
    id: k._id ? k._id.toString() : '',
    prefix: k.prefix,
    last4: k.last4,
    name: k.name,
    ownerId: k.ownerId,
    createdAt: k.createdAt,
    revokedAt: k.revokedAt,
    expiresAt: k.expiresAt,
  }));
}

export async function revokeApiKey(
  db: Db,
  keyId: string,
  userId: string,
  isAdmin: boolean,
): Promise<boolean> {
  const objId = toObjectId(keyId);
  if (!objId) {
    return false;
  }

  const filter: Filter<ApiKeyDocument> = { _id: objId, revokedAt: null };
  if (!isAdmin) {
    (filter as Record<string, unknown>)['ownerId'] = userId;
  }

  const res = await db.collection<ApiKeyDocument>('api_keys').updateOne(filter, {
    $set: { revokedAt: new Date() },
  });

  return res.modifiedCount > 0;
}

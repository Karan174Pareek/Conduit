import type { Db } from 'mongodb';
import { logger } from '../../logger.js';
import * as m0001 from './0001_init.js';

export interface Migration {
  version: number;
  name: string;
  up: (db: Db) => Promise<void>;
}

export const MIGRATIONS: Migration[] = [m0001];

export const TARGET_SCHEMA_VERSION = 1;

export interface SystemStateDoc {
  _id: string;
  holder?: string | null;
  acquiredAt?: Date;
  expiresAt?: Date;
  releasedAt?: Date;
  version?: number;
  appliedAt?: Date;
  name?: string;
  configVersion?: number;
  updatedAt?: Date;
}

export async function withStartupLock<T>(
  db: Db,
  lockId: string,
  holderId: string,
  fn: () => Promise<T>,
  ttlMs = 30000,
  maxWaitMs = 60000,
): Promise<T> {
  const collection = db.collection<SystemStateDoc>('system_state');
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);

    try {
      const res = await collection.findOneAndUpdate(
        {
          _id: lockId,
          $or: [
            { holder: null },
            { expiresAt: { $lt: now } },
            { holder: holderId },
          ],
        },
        {
          $set: {
            holder: holderId,
            acquiredAt: now,
            expiresAt,
          },
        },
        { upsert: true, returnDocument: 'after' },
      );

      if (res) {
        logger.debug({ lockId, holderId }, 'Acquired startup lock');
        try {
          const result = await fn();
          return result;
        } finally {
          await collection.updateOne(
            { _id: lockId, holder: holderId },
            { $set: { holder: null, releasedAt: new Date() } },
          ).catch((err) => {
            logger.warn({ err, lockId }, 'Failed to release startup lock cleanly');
          });
          logger.debug({ lockId, holderId }, 'Released startup lock');
        }
      }
    } catch (err: unknown) {
      // Duplicate key or write conflict during concurrent upsert is expected; retry
      const mongoErr = err as { code?: number };
      if (mongoErr.code !== 11000) {
        logger.debug({ err, lockId }, 'Lock acquisition attempt encountered error');
      }
    }

    // Wait 500ms before retrying
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for startup lock: ${lockId}`);
}

export async function getCurrentSchemaVersion(db: Db): Promise<number> {
  const doc = await db.collection<SystemStateDoc>('system_state').findOne({ _id: 'schema' });
  return doc?.version ?? 0;
}

export async function isSchemaReady(
  db: Db,
  requiredVersion = TARGET_SCHEMA_VERSION,
): Promise<boolean> {
  try {
    const current = await getCurrentSchemaVersion(db);
    return current >= requiredVersion;
  } catch {
    return false;
  }
}

export async function runMigrations(
  db: Db,
  holderId = `gateway-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
): Promise<void> {
  await withStartupLock(db, 'migration_lock', holderId, async () => {
    const currentVersion = await getCurrentSchemaVersion(db);
    logger.info({ currentVersion, targetVersion: TARGET_SCHEMA_VERSION }, 'Evaluating database migrations');

    for (const migration of MIGRATIONS) {
      if (migration.version > currentVersion) {
        logger.info(
          { version: migration.version, name: migration.name },
          'Applying database migration',
        );
        await migration.up(db);
        await db.collection<SystemStateDoc>('system_state').updateOne(
          { _id: 'schema' },
          {
            $set: {
              version: migration.version,
              appliedAt: new Date(),
              name: migration.name,
            },
          },
          { upsert: true },
        );
        logger.info(
          { version: migration.version, name: migration.name },
          'Migration successfully applied',
        );
      }
    }
  });
}

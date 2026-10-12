import type { Db } from 'mongodb';
import { logger } from '../logger.js';
import type { Config } from '../config.js';
import { hashPassword } from './password.js';
import { withStartupLock } from '../db/migrations/runner.js';

export async function bootstrapAdmin(
  db: Db,
  config: Config,
  holderId = `gateway-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
): Promise<void> {
  await withStartupLock(db, 'bootstrap_admin_lock', holderId, async () => {
    const adminCount = await db.collection('users').countDocuments({ role: 'admin' });

    if (adminCount === 0) {
      logger.info({ email: config.BOOTSTRAP_ADMIN_EMAIL }, 'Creating initial bootstrap admin user');
      const passwordHash = await hashPassword(config.BOOTSTRAP_ADMIN_PASSWORD);
      const now = new Date();

      await db.collection('users').insertOne({
        email: config.BOOTSTRAP_ADMIN_EMAIL.toLowerCase(),
        role: 'admin',
        passwordHash,
        failedLoginAttempts: 0,
        lockedUntil: null,
        createdAt: now,
        updatedAt: now,
      });

      logger.info({ email: config.BOOTSTRAP_ADMIN_EMAIL }, 'Bootstrap admin user successfully created');
    } else {
      logger.info('Admin user already exists; skipping bootstrap');
    }
  });
}

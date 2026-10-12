import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoClient, Db } from 'mongodb';
import { runMigrations, getCurrentSchemaVersion, isSchemaReady } from '../src/db/migrations/runner.js';
import * as m0001 from '../src/db/migrations/0001_init.js';

const TEST_MONGO_URI =
  process.env['TEST_MONGO_URI'] ||
  process.env['MONGO_URI'] ||
  'mongodb://root:rootpass@127.0.0.1:27017/conduit_test_mig?authSource=admin';

describe('Migration 0002 Tool Catalog Index Fixes', { timeout: 30000 }, () => {
  let mongoClient: MongoClient;
  let db: Db;

  beforeAll(async () => {
    mongoClient = new MongoClient(TEST_MONGO_URI, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
    });
    await mongoClient.connect();
    db = mongoClient.db();
  });

  afterAll(async () => {
    if (mongoClient) {
      await db.dropDatabase();
      await mongoClient.close();
    }
  });

  it('proves clean application on a fresh DB and gates /readyz on schema version 2', async () => {
    await db.dropDatabase();

    expect(await isSchemaReady(db, 2)).toBe(false);

    await runMigrations(db, 'fresh-runner');

    expect(await getCurrentSchemaVersion(db)).toBeGreaterThanOrEqual(2);
    expect(await isSchemaReady(db, 2)).toBe(true);

    const indexes = await db.collection('tool_catalog').indexes();
    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain('serverId_1_name_1');
    expect(indexNames).toContain('exposedName_1');
    expect(indexNames).toContain('approval.status_1');
    expect(indexNames).not.toContain('serverSlug_1_toolName_1');
    expect(indexNames).not.toContain('approved_1');
  });

  it('proves idempotent upgrade from Phase 3A database with legacy indexes', async () => {
    await db.dropDatabase();

    // 1. Simulate Phase 3A initial state: run 0001_init directly and set schema version = 1
    await m0001.up(db);
    await db.collection('system_state').updateOne(
      { _id: 'schema' },
      { $set: { version: 1, appliedAt: new Date(), name: '0001_init' } },
      { upsert: true },
    );

    // Verify 3A legacy indexes are present
    const initIndexes = await db.collection('tool_catalog').indexes();
    const initIndexNames = initIndexes.map((i) => i.name);
    expect(initIndexNames).toContain('serverSlug_1_toolName_1');
    expect(initIndexNames).toContain('approved_1');
    expect(initIndexNames).not.toContain('serverId_1_name_1');
    expect(await isSchemaReady(db, 2)).toBe(false);

    // 2. Run runner: applies 0002
    await runMigrations(db, 'upgrade-runner');

    expect(await getCurrentSchemaVersion(db)).toBeGreaterThanOrEqual(2);
    expect(await isSchemaReady(db, 2)).toBe(true);

    const upgradedIndexes = await db.collection('tool_catalog').indexes();
    const upgradedNames = upgradedIndexes.map((i) => i.name);
    expect(upgradedNames).not.toContain('serverSlug_1_toolName_1');
    expect(upgradedNames).not.toContain('approved_1');
    expect(upgradedNames).toContain('serverId_1_name_1');
    expect(upgradedNames).toContain('exposedName_1');
    expect(upgradedNames).toContain('approval.status_1');

    // 3. Run runner again: proves running twice is idempotent
    await runMigrations(db, 'upgrade-runner-2');
    expect(await getCurrentSchemaVersion(db)).toBeGreaterThanOrEqual(2);

    const recheckIndexes = await db.collection('tool_catalog').indexes();
    const recheckNames = recheckIndexes.map((i) => i.name);
    expect(recheckNames).toContain('serverId_1_name_1');
    expect(recheckNames).not.toContain('serverSlug_1_toolName_1');
  });
});

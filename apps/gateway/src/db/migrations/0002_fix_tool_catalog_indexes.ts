import type { Db } from 'mongodb';

export const version = 2;
export const name = '0002_fix_tool_catalog_indexes';

export async function up(db: Db): Promise<void> {
  const collection = db.collection('tool_catalog');

  // Idempotently drop legacy indexes from Phase 3A if they exist
  await collection.dropIndex('serverSlug_1_toolName_1').catch(() => {});
  await collection.dropIndex('approved_1').catch(() => {});

  // Ensure correct compound and unique indexes
  await collection.createIndex(
    { serverId: 1, name: 1 },
    { unique: true },
  );
  await collection.createIndex(
    { exposedName: 1 },
    { unique: true },
  );
  await collection.createIndex(
    { 'approval.status': 1 },
  );
}

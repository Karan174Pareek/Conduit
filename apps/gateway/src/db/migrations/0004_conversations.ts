import type { Db } from 'mongodb';

export const version = 4;
export const name = '0004_conversations';

export async function up(db: Db): Promise<void> {
  const conversations = db.collection('conversations');
  const messages = db.collection('messages');

  // Indexes from docs/DATABASE.md §2.10
  await conversations.createIndex({ userId: 1, updatedAt: -1 });
  await messages.createIndex({ conversationId: 1, createdAt: 1 });
  await messages.createIndex({ userId: 1, createdAt: -1 });
}

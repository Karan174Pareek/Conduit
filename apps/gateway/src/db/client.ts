import { MongoClient, Db } from 'mongodb';
import { logger } from '../logger.js';

let client: MongoClient | null = null;
let dbInstance: Db | null = null;

export async function connectToDatabase(uri: string): Promise<{ client: MongoClient; db: Db }> {
  if (client && dbInstance) {
    return { client, db: dbInstance };
  }

  const newClient = new MongoClient(uri, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
    socketTimeoutMS: 10000,
  });

  await newClient.connect();
  client = newClient;
  dbInstance = newClient.db();
  logger.info({ database: dbInstance.databaseName }, 'Connected to MongoDB');
  return { client, db: dbInstance };
}

export function getDb(): Db {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call connectToDatabase() first.');
  }
  return dbInstance;
}

export function getMongoClient(): MongoClient {
  if (!client) {
    throw new Error('MongoClient not initialized. Call connectToDatabase() first.');
  }
  return client;
}

export async function closeDatabase(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    dbInstance = null;
    logger.info('MongoDB connection closed');
  }
}

export async function pingDatabase(): Promise<boolean> {
  if (!client || !dbInstance) return false;
  try {
    await dbInstance.command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

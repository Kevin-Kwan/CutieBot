import { MongoClient } from 'mongodb';
import type { AppLogger } from '../core/logger.js';
import type { DbHandles } from '../core/context.js';

/**
 * MongoDB client lifecycle (PLAN §6).
 *
 * The old bot passed driver options that mongodb 6+ removed
 * (useNewUrlParser / useUnifiedTopology) and never called connect()
 * explicitly. Here: construct with driver defaults, connect once at boot,
 * close on shutdown.
 */
export async function connectMongo(uri: string, logger: AppLogger): Promise<DbHandles> {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  logger.info({ dbName: db.databaseName }, 'connected to MongoDB');
  return { client, db };
}

export async function closeMongo(handles: DbHandles, logger: AppLogger): Promise<void> {
  await handles.client.close();
  logger.info('closed MongoDB connection');
}

import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';

/**
 * ONE shared in-memory replica set for the whole test run (Phase 6,
 * AUDIT6 G9 / P2-15). Previously each integration suite spawned its own
 * MongoMemoryReplSet; three replica sets racing on this host flaked and
 * orphaned data dirs filled /tmp. Now: a single replica set starts here,
 * its URI is provided to every worker, and each integration suite uses
 * its OWN database name on the shared server for isolation.
 */
declare module 'vitest' {
  interface ProvidedContext {
    mongoUri: string;
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  project.provide('mongoUri', replSet.getUri());
  return async () => {
    await replSet.stop();
  };
}

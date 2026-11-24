import type { Db } from 'mongodb';
import type { AppLogger } from '../core/logger.js';
import { AI_USAGE_COLLECTION } from '../features/ai/limits.mongo.js';
import {
  ECONOMY_IDEMPOTENCY_COLLECTION,
  ECONOMY_QUARANTINE_COLLECTION,
} from '../features/economy/economy.repo.js';
import { ECONOMY_COLLECTION } from '../features/economy/types.js';

/**
 * Index setup (PLAN §6), run once at boot after connect.
 *
 * The economy collection gets a unique index on `userId` — the backstop
 * that makes ensureUser's upsert safe under concurrency (the old bot had
 * no unique index, so racing `open_bank` inserts could create duplicates,
 * AUDIT §5.20). The leaderboard sorts by a computed net worth, which no
 * index can serve; at this bot's scale the capped aggregation is fine
 * without one.
 */
export async function ensureIndexes(db: Db, logger?: AppLogger): Promise<void> {
  const economy = db.collection(ECONOMY_COLLECTION);
  await economy.createIndex(
    { userId: 1 },
    {
      unique: true,
      name: 'economy_userId_unique',
      // Legacy documents have no userId field (they key on _id alone), and
      // a plain unique index would refuse to build over them (duplicate
      // nulls). The partial filter scopes uniqueness to v3-shaped docs;
      // legacy docs gain a userId the first time they are read + repaired.
      partialFilterExpression: { userId: { $type: 'string' } },
    },
  );
  // AI usage counters are one document per scope per UTC day, keyed by
  // _id (no lookup index needed). The TTL index reaps day documents
  // three days after creation so the collection stays bounded.
  const aiUsage = db.collection(AI_USAGE_COLLECTION);
  await aiUsage.createIndex(
    { createdAt: 1 },
    { expireAfterSeconds: 3 * 24 * 3600, name: 'ai_usage_createdAt_ttl' },
  );

  // Economy idempotency ledger (Phase 6, P1-01/G3): one document per
  // interaction id, inserted inside the mutation's transaction. The
  // TTL index reaps records 24 h after creation — long past any
  // plausible interaction redelivery.
  const idempotency = db.collection(ECONOMY_IDEMPOTENCY_COLLECTION);
  await idempotency.createIndex(
    { createdAt: 1 },
    { expireAfterSeconds: 24 * 3600, name: 'economy_idempotency_ttl' },
  );

  // Economy quarantine events (Phase 6c, R1): append-only records of
  // un-normalizable account documents. The freeze check —
  // { userId, resolvedAt: null } — runs on every account creation, so
  // it gets a compound index. Events are operator evidence: no TTL.
  const quarantine = db.collection(ECONOMY_QUARANTINE_COLLECTION);
  await quarantine.createIndex(
    { userId: 1, resolvedAt: 1 },
    { name: 'economy_quarantine_user_resolved' },
  );

  logger?.info(
    {
      collections: [
        ECONOMY_COLLECTION,
        AI_USAGE_COLLECTION,
        ECONOMY_IDEMPOTENCY_COLLECTION,
        ECONOMY_QUARANTINE_COLLECTION,
      ],
    },
    'database indexes ensured',
  );
}

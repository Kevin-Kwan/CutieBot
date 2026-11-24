import { MongoClient, type Db } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { ensureIndexes } from '../../../src/db/indexes.js';
import { AI_USAGE_COLLECTION, MongoUsageLimiter } from '../../../src/features/ai/limits.mongo.js';
import { utcDayKey } from '../../../src/features/ai/limits.js';

/**
 * Integration tests for the persisted AI usage limiter (PLAN §8: AI
 * quota is durable). Shared replica set (tests/global-setup.ts), own database name.
 * suites. Targets: cap enforcement with the global-before-user check
 * order, rejected consumes leaving counters untouched, UTC day
 * rollover via the injected clock, and exactness under concurrency —
 * the properties the in-memory implementation cannot prove for the
 * production wiring.
 */

let client: MongoClient;
let db: Db;

// 2026-01-01T12:00:00Z — mid-day UTC, so small clock moves stay in-day.
const DAY_ONE = Date.UTC(2026, 0, 1, 12);
const DAY_MS = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  // Shared replica set from tests/global-setup.ts (Phase 6, G9).
  client = new MongoClient(inject('mongoUri'));
  await client.connect();
  db = client.db('cutiebot-test-ai');
  await ensureIndexes(db);
}, 300_000);

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await db.collection(AI_USAGE_COLLECTION).deleteMany({});
});

function makeLimiter(
  overrides: {
    perUserDaily?: number;
    globalDaily?: number;
    now?: () => number;
  } = {},
): MongoUsageLimiter {
  return new MongoUsageLimiter(
    { client, db },
    {
      perUserDaily: overrides.perUserDaily ?? 3,
      globalDaily: overrides.globalDaily ?? 5,
      now: overrides.now ?? (() => DAY_ONE),
    },
  );
}

interface RawUsageDoc {
  _id: string;
  count: number;
  createdAt: Date;
}

async function rawDoc(id: string): Promise<RawUsageDoc | null> {
  return db.collection<RawUsageDoc>(AI_USAGE_COLLECTION).findOne({ _id: id });
}

describe('MongoUsageLimiter — caps', () => {
  it('allows consumes up to the per-user cap, then rejects with scope "user"', async () => {
    const limiter = makeLimiter({ perUserDaily: 2, globalDaily: 100 });
    await expect(limiter.tryConsume('u1')).resolves.toEqual({ allowed: true });
    await expect(limiter.tryConsume('u1')).resolves.toEqual({ allowed: true });
    await expect(limiter.tryConsume('u1')).resolves.toEqual({ allowed: false, scope: 'user' });
    await expect(limiter.counts()).resolves.toEqual({ global: 2 });
    await expect(limiter.remaining('u1')).resolves.toBe(0);
    await expect(limiter.remaining('u2')).resolves.toBe(2);
  });

  it('rejects with scope "global" when the global cap is hit, checked before the user cap', async () => {
    const limiter = makeLimiter({ perUserDaily: 1, globalDaily: 1 });
    await expect(limiter.tryConsume('u1')).resolves.toEqual({ allowed: true });
    // u1 is at BOTH caps; the reported scope must be "global".
    await expect(limiter.tryConsume('u1')).resolves.toEqual({ allowed: false, scope: 'global' });
    await expect(limiter.tryConsume('u2')).resolves.toEqual({ allowed: false, scope: 'global' });
  });

  it('a rejected consume leaves every counter untouched (global increment is rolled back)', async () => {
    const limiter = makeLimiter({ perUserDaily: 1, globalDaily: 100 });
    await limiter.tryConsume('u1');
    await expect(limiter.tryConsume('u1')).resolves.toEqual({ allowed: false, scope: 'user' });
    const day = utcDayKey(DAY_ONE);
    expect((await rawDoc(`user:u1:${day}`))?.count).toBe(1);
    // The global doc must read 1, not 2: the failed user consume
    // incremented global first and had to compensate.
    expect((await rawDoc(`global:${day}`))?.count).toBe(1);
    await expect(limiter.counts()).resolves.toEqual({ global: 1 });
  });

  it('stores one document per scope per UTC day, with a creation timestamp for the TTL index', async () => {
    const limiter = makeLimiter();
    await limiter.tryConsume('u1');
    const day = utcDayKey(DAY_ONE);
    const userDoc = await rawDoc(`user:u1:${day}`);
    const globalDoc = await rawDoc(`global:${day}`);
    expect(userDoc?.count).toBe(1);
    expect(globalDoc?.count).toBe(1);
    expect(userDoc?.createdAt).toBeInstanceOf(Date);
    expect(await db.collection(AI_USAGE_COLLECTION).countDocuments({})).toBe(2);
  });
});

describe('MongoUsageLimiter — UTC day rollover (injected clock)', () => {
  it('counts against a fresh day after the UTC boundary, keeping the old day intact', async () => {
    let nowMs = DAY_ONE;
    const limiter = makeLimiter({ perUserDaily: 1, globalDaily: 1, now: () => nowMs });
    await expect(limiter.tryConsume('u1')).resolves.toEqual({ allowed: true });
    await expect(limiter.tryConsume('u1')).resolves.toEqual({ allowed: false, scope: 'global' });

    nowMs = DAY_ONE + DAY_MS; // next UTC day
    await expect(limiter.tryConsume('u1')).resolves.toEqual({ allowed: true });
    await expect(limiter.counts()).resolves.toEqual({ global: 1 });

    // Both days' documents exist side by side; the TTL index reaps
    // the old one later.
    expect((await rawDoc(`global:${utcDayKey(DAY_ONE)}`))?.count).toBe(1);
    expect((await rawDoc(`global:${utcDayKey(DAY_ONE + DAY_MS)}`))?.count).toBe(1);
  });

  it('does not roll over within the same UTC day', async () => {
    let nowMs = DAY_ONE;
    const limiter = makeLimiter({ perUserDaily: 1, globalDaily: 10, now: () => nowMs });
    await expect(limiter.tryConsume('u1')).resolves.toEqual({ allowed: true });
    nowMs = DAY_ONE + 6 * 60 * 60 * 1000; // 18:00 UTC, same day
    await expect(limiter.tryConsume('u1')).resolves.toEqual({ allowed: false, scope: 'user' });
    await expect(limiter.counts()).resolves.toEqual({ global: 1 });
  });
});

describe('MongoUsageLimiter — concurrency', () => {
  it('20 racing consumes against a per-user cap of 5: exactly 5 land', async () => {
    const limiter = makeLimiter({ perUserDaily: 5, globalDaily: 100 });
    const results = await Promise.all(
      Array.from({ length: 20 }, () => limiter.tryConsume('racer')),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(5);
    expect(results.filter((result) => !result.allowed)).toHaveLength(15);
    const day = utcDayKey(DAY_ONE);
    expect((await rawDoc(`user:racer:${day}`))?.count).toBe(5);
    expect((await rawDoc(`global:${day}`))?.count).toBe(5);
  });

  it('racing users against a global cap of 3: exactly 3 land across all users', async () => {
    const limiter = makeLimiter({ perUserDaily: 100, globalDaily: 3 });
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => limiter.tryConsume(`user-${i}`)),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(3);
    await expect(limiter.counts()).resolves.toEqual({ global: 3 });
  });
});

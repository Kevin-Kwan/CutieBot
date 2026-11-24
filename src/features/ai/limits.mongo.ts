import type { ClientSession, Collection } from 'mongodb';
import type { DbHandles } from '../../core/context.js';
import { TrustedMessageError } from '../../core/errors.js';
import {
  utcDayKey,
  type ConsumeResult,
  type LimitScope,
  type UsageLimiter,
  type UsageLimiterOptions,
} from './limits.js';

/**
 * MongoDB-backed usage limiter (PLAN §8: AI quota is durable) — the
 * production implementation of the UsageLimiter interface. Counts live
 * in one document per scope per UTC day:
 *
 *   { _id: 'global:<YYYY-MM-DD>' | 'user:<userId>:<YYYY-MM-DD>',
 *     count: number, createdAt: Date }
 *
 * so a restart never resets the caps (the legacy bot's in-memory
 * cooldowns did exactly that — AUDIT §2.3). `createdAt` exists so a
 * TTL index (src/db/indexes.ts) can reap old day documents.
 *
 * Atomicity (Phase 6, AUDIT6 P1-03 / G12): tryConsume runs BOTH
 * guarded increments inside ONE transaction. The previous shape —
 * increment global, increment user, then a compensating decrement on
 * refusal — was not atomic: a crash between the steps leaked global
 * quota, and a failed compensation did the same. Now a refusal aborts
 * the transaction and every counter stays untouched, by construction.
 * Each increment is a guarded findOneAndUpdate whose filter requires
 * count < cap ("increment-if-below-cap"). Global is consumed first,
 * mirroring the in-memory limiter's check order.
 */

export const AI_USAGE_COLLECTION = 'ai_usage';

interface UsageDoc {
  _id: string;
  count: number;
  createdAt: Date;
}

/** Internal control-flow signal: abort the consume transaction as a refusal. */
export class LimiterRefused extends TrustedMessageError {
  constructor(readonly scope: LimitScope) {
    super(`usage limit reached (${scope})`);
    this.name = 'LimiterRefused';
  }
}

export class MongoUsageLimiter implements UsageLimiter {
  private readonly perUserDaily: number;
  private readonly globalDaily: number;
  private readonly now: () => number;

  constructor(
    private readonly handles: DbHandles,
    options: UsageLimiterOptions,
  ) {
    if (!Number.isFinite(options.perUserDaily) || options.perUserDaily < 0) {
      throw new RangeError('perUserDaily must be a finite number >= 0');
    }
    if (!Number.isFinite(options.globalDaily) || options.globalDaily < 0) {
      throw new RangeError('globalDaily must be a finite number >= 0');
    }
    this.perUserDaily = options.perUserDaily;
    this.globalDaily = options.globalDaily;
    this.now = options.now ?? Date.now;
  }

  private collection(): Collection<UsageDoc> {
    return this.handles.db.collection<UsageDoc>(AI_USAGE_COLLECTION);
  }

  private globalKey(nowMs: number): string {
    return `global:${utcDayKey(nowMs)}`;
  }

  private userKey(userId: string, nowMs: number): string {
    return `user:${userId}:${utcDayKey(nowMs)}`;
  }

  /**
   * Increment the counter for `key` by one, only while it is below
   * `cap`, inside the caller's transaction. Returns false when the cap
   * is already reached.
   *
   * Read-first, deliberately NOT a guarded upsert: when the document
   * exists but is at cap, an upsert whose filter includes
   * `count: { $lt: cap }` matches nothing and tries to INSERT a
   * duplicate _id (E11000). Inside the transaction snapshot the read
   * is authoritative; a concurrent first-consume insert surfaces as a
   * write conflict, which aborts and retries the whole transaction —
   * the retry then sees the document and takes the update path.
   */
  private async incrementIfBelow(
    key: string,
    cap: number,
    nowMs: number,
    session: ClientSession,
  ): Promise<boolean> {
    if (cap <= 0) return false;
    const existing = await this.collection().findOne({ _id: key }, { session });
    if (existing !== null) {
      if (existing.count >= cap) return false;
      const result = await this.collection().updateOne(
        { _id: key, count: { $lt: cap } },
        { $inc: { count: 1 } },
        { session },
      );
      return result.matchedCount > 0;
    }
    await this.collection().insertOne(
      { _id: key, count: 1, createdAt: new Date(nowMs) },
      { session },
    );
    return true;
  }

  private async countOf(key: string): Promise<number> {
    const doc = await this.collection().findOne({ _id: key });
    return doc?.count ?? 0;
  }

  public async tryConsume(userId: string): Promise<ConsumeResult> {
    const nowMs = this.now();
    const globalKey = this.globalKey(nowMs);
    const userKey = this.userKey(userId, nowMs);

    const session = this.handles.client.startSession();
    try {
      let refused: LimitScope | null = null;
      await session.withTransaction(async () => {
        refused = null;
        if (!(await this.incrementIfBelow(globalKey, this.globalDaily, nowMs, session))) {
          refused = 'global';
          return; // nothing written — the commit is a no-op
        }
        if (!(await this.incrementIfBelow(userKey, this.perUserDaily, nowMs, session))) {
          // Abort: the global increment rolls back with the transaction,
          // so a rejected consume leaves every counter untouched.
          throw new LimiterRefused('user');
        }
      });
      return refused === null ? { allowed: true } : { allowed: false, scope: refused };
    } catch (error) {
      if (error instanceof LimiterRefused) return { allowed: false, scope: error.scope };
      throw error;
    } finally {
      await session.endSession();
    }
  }

  public async remaining(userId: string): Promise<number> {
    const nowMs = this.now();
    const [userCount, globalCount] = await Promise.all([
      this.countOf(this.userKey(userId, nowMs)),
      this.countOf(this.globalKey(nowMs)),
    ]);
    return Math.max(0, Math.min(this.perUserDaily - userCount, this.globalDaily - globalCount));
  }

  public async counts(): Promise<{ global: number }> {
    return { global: await this.countOf(this.globalKey(this.now())) };
  }
}

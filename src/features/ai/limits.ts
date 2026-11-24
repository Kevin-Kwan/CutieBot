/**
 * Daily AI usage caps (PLAN §8): a per-user cap AND a global cap (the
 * circuit breaker), counted per UTC day and enforced BEFORE any provider
 * call. The legacy bot had no cost control at all — a substring trigger
 * plus GPT-4 meant anyone could burn API spend as fast as they could
 * type (AUDIT §6.5).
 *
 * The interface is async because the production implementation
 * (limits.mongo.ts) does database I/O; the in-memory implementation
 * below keeps identical semantics for tests and dev. Check order is
 * deliberate and shared by both: the GLOBAL cap is checked first, so a
 * single user is never blamed (or shown a per-user limit message) when
 * the whole bot is out of budget, and operators can distinguish
 * "global" rejections in logs.
 *
 * Integrated from the Gemini 4 Neon Phase 5 draft (see
 * cutiebot-refactor/model-drafts/ai); the interface methods return
 * promises so both implementations share it. Phase 6: the default cap
 * constants moved to config/env.ts (AI_PER_USER_DAILY_CAP /
 * AI_GLOBAL_DAILY_CAP env vars) — caps are operator config, not code.
 */

export type LimitScope = 'user' | 'global';

export interface ConsumeResult {
  readonly allowed: boolean;
  /** Which cap rejected the consume; absent when allowed. */
  readonly scope?: LimitScope;
}

export interface UsageLimiterOptions {
  readonly perUserDaily: number;
  readonly globalDaily: number;
  readonly now?: () => number;
}

export interface UsageLimiter {
  /** Atomically consume one unit for `userId`, if both caps allow it. */
  tryConsume(userId: string): Promise<ConsumeResult>;
  /** Units `userId` may still consume today (min of both headrooms). */
  remaining(userId: string): Promise<number>;
  /** Total units consumed today across all users. */
  counts(): Promise<{ global: number }>;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function utcDayStart(nowMs: number): number {
  return Math.floor(nowMs / MS_PER_DAY) * MS_PER_DAY;
}

/** UTC day key (`YYYY-MM-DD`) for a timestamp — the Mongo limiter's doc key part. */
export function utcDayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function validateCaps(options: UsageLimiterOptions): void {
  if (!Number.isFinite(options.perUserDaily) || options.perUserDaily < 0) {
    throw new RangeError('perUserDaily must be a finite number >= 0');
  }
  if (!Number.isFinite(options.globalDaily) || options.globalDaily < 0) {
    throw new RangeError('globalDaily must be a finite number >= 0');
  }
}

/**
 * In-memory limiter. Counts reset lazily at the UTC day boundary.
 * Loses counts on restart — acceptable for tests/dev; production wires
 * MongoUsageLimiter instead (see service.ts).
 */
export class DailyUsageLimiter implements UsageLimiter {
  private readonly perUserDaily: number;
  private readonly globalDaily: number;
  private readonly now: () => number;
  private dayStartMs: number;
  private globalCount = 0;
  private readonly perUserCounts = new Map<string, number>();

  public constructor(options: UsageLimiterOptions) {
    validateCaps(options);
    this.perUserDaily = options.perUserDaily;
    this.globalDaily = options.globalDaily;
    this.now = options.now ?? Date.now;
    this.dayStartMs = utcDayStart(this.now());
  }

  public tryConsume(userId: string): Promise<ConsumeResult> {
    this.rolloverIfNeeded();
    if (this.globalCount >= this.globalDaily) {
      return Promise.resolve({ allowed: false, scope: 'global' });
    }
    const userCount = this.perUserCounts.get(userId) ?? 0;
    if (userCount >= this.perUserDaily) {
      return Promise.resolve({ allowed: false, scope: 'user' });
    }
    this.perUserCounts.set(userId, userCount + 1);
    this.globalCount += 1;
    return Promise.resolve({ allowed: true });
  }

  public remaining(userId: string): Promise<number> {
    this.rolloverIfNeeded();
    const userCount = this.perUserCounts.get(userId) ?? 0;
    const userRemaining = this.perUserDaily - userCount;
    const globalRemaining = this.globalDaily - this.globalCount;
    return Promise.resolve(Math.max(0, Math.min(userRemaining, globalRemaining)));
  }

  public counts(): Promise<{ global: number }> {
    this.rolloverIfNeeded();
    return Promise.resolve({ global: this.globalCount });
  }

  private rolloverIfNeeded(): void {
    const today = utcDayStart(this.now());
    if (today === this.dayStartMs) {
      return;
    }
    this.dayStartMs = today;
    this.globalCount = 0;
    this.perUserCounts.clear();
  }
}

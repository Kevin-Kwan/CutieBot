/**
 * In-memory anti-spam throttle store (PLAN §6).
 *
 * Used ONLY for short anti-spam cooldowns (command rate limits). Durable
 * cooldowns (economy claims) live on the user document in Mongo; AI quota is
 * durable too. Restarting the bot resets these throttles, which is fine.
 *
 * The clock is injectable so tests can control time.
 */
/** Store size above which hit() sweeps expired entries opportunistically. */
const SWEEP_THRESHOLD = 1000;

export class CooldownStore {
  private readonly expiries = new Map<string, number>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /**
   * Try to acquire the slot for `key` for `durationMs`.
   * Returns 0 when acquired, otherwise the milliseconds remaining.
   */
  hit(key: string, durationMs: number): number {
    // Opportunistic sweep (Phase 6, G15): previously sweep() had no
    // production caller, so expired entries accumulated until restart.
    if (this.expiries.size > SWEEP_THRESHOLD) this.sweep();
    const now = this.now();
    const expiry = this.expiries.get(key);
    if (expiry !== undefined && expiry > now) {
      return expiry - now;
    }
    this.expiries.set(key, now + durationMs);
    return 0;
  }

  /** Milliseconds remaining for `key`, or 0 when not throttled. */
  remaining(key: string): number {
    const expiry = this.expiries.get(key);
    if (expiry === undefined) return 0;
    const left = expiry - this.now();
    if (left <= 0) {
      this.expiries.delete(key);
      return 0;
    }
    return left;
  }

  /** Clear a key immediately (e.g. after a successful privileged action). */
  clear(key: string): void {
    this.expiries.delete(key);
  }

  /** Drop expired entries; called opportunistically to bound memory. */
  sweep(): void {
    const now = this.now();
    for (const [key, expiry] of this.expiries) {
      if (expiry <= now) this.expiries.delete(key);
    }
  }

  get size(): number {
    return this.expiries.size;
  }
}

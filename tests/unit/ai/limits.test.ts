import { describe, expect, it } from 'vitest';
import { DailyUsageLimiter } from '../../../src/features/ai/limits.js';

const DAY_MS = 24 * 60 * 60 * 1000;
// 2026-01-01T00:00:00Z — a clean UTC day boundary for the fake clock.
const DAY_START = Date.UTC(2026, 0, 1);

function makeLimiter(
  overrides: {
    perUserDaily?: number;
    globalDaily?: number;
    now?: () => number;
  } = {},
): DailyUsageLimiter {
  return new DailyUsageLimiter({
    perUserDaily: 3,
    globalDaily: 5,
    ...overrides,
  });
}

describe('DailyUsageLimiter', () => {
  it('allows consumes up to the per-user cap, then rejects with scope "user"', async () => {
    const limiter = makeLimiter({ perUserDaily: 2, globalDaily: 100 });
    expect(await limiter.tryConsume('u1')).toEqual({ allowed: true });
    expect(await limiter.tryConsume('u1')).toEqual({ allowed: true });
    expect(await limiter.tryConsume('u1')).toEqual({ allowed: false, scope: 'user' });
    expect(await limiter.counts()).toEqual({ global: 2 });
    expect(await limiter.remaining('u1')).toBe(0);
  });

  it('allows other users after one user hits their cap', async () => {
    const limiter = makeLimiter({ perUserDaily: 1, globalDaily: 100 });
    expect((await limiter.tryConsume('u1')).allowed).toBe(true);
    expect((await limiter.tryConsume('u1')).allowed).toBe(false);
    expect((await limiter.tryConsume('u2')).allowed).toBe(true);
  });

  it('rejects with scope "global" when the global cap is hit, even for a fresh user', async () => {
    const limiter = makeLimiter({ perUserDaily: 10, globalDaily: 2 });
    expect((await limiter.tryConsume('u1')).allowed).toBe(true);
    expect((await limiter.tryConsume('u2')).allowed).toBe(true);
    const result = await limiter.tryConsume('u3');
    expect(result).toEqual({ allowed: false, scope: 'global' });
    expect(await limiter.counts()).toEqual({ global: 2 });
  });

  it('checks the global cap before the per-user cap', async () => {
    const limiter = makeLimiter({ perUserDaily: 1, globalDaily: 1 });
    expect((await limiter.tryConsume('u1')).allowed).toBe(true);
    // u1 is at their per-user cap AND the global cap is full:
    // the reported scope must be "global".
    expect(await limiter.tryConsume('u1')).toEqual({ allowed: false, scope: 'global' });
  });

  it('a rejected consume does not increment any counter', async () => {
    const limiter = makeLimiter({ perUserDaily: 1, globalDaily: 1 });
    expect((await limiter.tryConsume('u1')).allowed).toBe(true);
    expect((await limiter.tryConsume('u1')).allowed).toBe(false);
    expect((await limiter.tryConsume('u2')).allowed).toBe(false);
    expect(await limiter.counts()).toEqual({ global: 1 });
    expect(await limiter.remaining('u1')).toBe(0);
    expect(await limiter.remaining('u2')).toBe(0);
  });

  it('rolls counters over at the UTC day boundary (fake clock)', async () => {
    let nowMs = DAY_START + 23 * 60 * 60 * 1000; // 23:00 UTC
    const limiter = makeLimiter({
      perUserDaily: 1,
      globalDaily: 1,
      now: () => nowMs,
    });
    expect((await limiter.tryConsume('u1')).allowed).toBe(true);
    expect((await limiter.tryConsume('u1')).allowed).toBe(false);
    // Cross into the next UTC day: counters reset lazily.
    nowMs = DAY_START + DAY_MS + 60 * 1000; // next day, 00:01 UTC
    expect(await limiter.tryConsume('u1')).toEqual({ allowed: true });
    expect(await limiter.counts()).toEqual({ global: 1 });
    expect(await limiter.remaining('u1')).toBe(0);
  });

  it('does not roll over within the same UTC day', async () => {
    let nowMs = DAY_START + 60 * 1000; // 00:01 UTC
    const limiter = makeLimiter({
      perUserDaily: 1,
      globalDaily: 10,
      now: () => nowMs,
    });
    expect((await limiter.tryConsume('u1')).allowed).toBe(true);
    nowMs = DAY_START + 23 * 60 * 60 * 1000; // 23:00 UTC, same day
    expect((await limiter.tryConsume('u1')).allowed).toBe(false);
    expect(await limiter.counts()).toEqual({ global: 1 });
  });

  it('remaining() is the min of the user and global headroom', async () => {
    const limiter = makeLimiter({ perUserDaily: 5, globalDaily: 3 });
    expect(await limiter.remaining('u1')).toBe(3); // global is the binding cap
    expect((await limiter.tryConsume('u1')).allowed).toBe(true);
    expect(await limiter.remaining('u1')).toBe(2);
    expect(await limiter.remaining('u2')).toBe(2); // global headroom shared
    expect((await limiter.tryConsume('u2')).allowed).toBe(true);
    expect((await limiter.tryConsume('u2')).allowed).toBe(true);
    expect(await limiter.remaining('u1')).toBe(0);
    expect(await limiter.remaining('u2')).toBe(0);
  });

  it('remaining() reflects the per-user cap when it is the binding one', async () => {
    const limiter = makeLimiter({ perUserDaily: 2, globalDaily: 100 });
    expect(await limiter.remaining('u1')).toBe(2);
    expect((await limiter.tryConsume('u1')).allowed).toBe(true);
    expect(await limiter.remaining('u1')).toBe(1);
    expect(await limiter.remaining('u2')).toBe(2);
  });

  it('zero caps reject everything and report zero remaining', async () => {
    const limiter = makeLimiter({ perUserDaily: 0, globalDaily: 0 });
    expect(await limiter.tryConsume('u1')).toEqual({ allowed: false, scope: 'global' });
    expect(await limiter.remaining('u1')).toBe(0);
    expect(await limiter.counts()).toEqual({ global: 0 });
  });
});

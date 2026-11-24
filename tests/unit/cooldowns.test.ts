import { describe, expect, it } from 'vitest';
import { CooldownStore } from '../../src/core/cooldowns.js';

function fakeClock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe('CooldownStore', () => {
  it('acquires immediately for a fresh key', () => {
    const clock = fakeClock();
    const store = new CooldownStore(clock.now);
    expect(store.hit('k', 5_000)).toBe(0);
  });

  it('reports remaining time while throttled', () => {
    const clock = fakeClock();
    const store = new CooldownStore(clock.now);
    expect(store.hit('k', 5_000)).toBe(0);
    clock.advance(1_500);
    expect(store.hit('k', 5_000)).toBe(3_500);
    expect(store.remaining('k')).toBe(3_500);
  });

  it('acquires again after expiry', () => {
    const clock = fakeClock();
    const store = new CooldownStore(clock.now);
    expect(store.hit('k', 5_000)).toBe(0);
    clock.advance(5_000);
    expect(store.remaining('k')).toBe(0);
    expect(store.hit('k', 5_000)).toBe(0);
  });

  it('tracks keys independently and clears on demand', () => {
    const clock = fakeClock();
    const store = new CooldownStore(clock.now);
    expect(store.hit('a', 5_000)).toBe(0);
    expect(store.hit('b', 5_000)).toBe(0);
    store.clear('a');
    expect(store.hit('a', 5_000)).toBe(0);
    expect(store.hit('b', 5_000)).toBeGreaterThan(0);
  });

  it('sweep drops expired entries', () => {
    const clock = fakeClock();
    const store = new CooldownStore(clock.now);
    store.hit('a', 1_000);
    store.hit('b', 60_000);
    clock.advance(2_000);
    store.sweep();
    expect(store.size).toBe(1);
    expect(store.remaining('b')).toBeGreaterThan(0);
  });
});

import type { Track } from 'discord-player';
import { describe, expect, it } from 'vitest';
import { SearchSessionStore } from '../../../src/features/music/sessions.js';

const fakeTrack = { title: 'Song' } as unknown as Track;

function makeStore(start = 1_000_000) {
  let now = start;
  return {
    store: new SearchSessionStore(() => now),
    advance: (ms: number): void => {
      now += ms;
    },
  };
}

describe('SearchSessionStore', () => {
  it('stores and returns a session', () => {
    const { store } = makeStore();
    store.put('s1', { userId: 'u1', guildId: 'g1', tracks: [fakeTrack] });
    const session = store.get('s1');
    expect(session?.userId).toBe('u1');
    expect(session?.tracks).toHaveLength(1);
    expect(store.size).toBe(1);
  });

  it('expires sessions after the TTL', () => {
    const { store, advance } = makeStore();
    store.put('s1', { userId: 'u1', guildId: 'g1', tracks: [] }, 5_000);
    advance(4_999);
    expect(store.get('s1')).toBeDefined();
    advance(1);
    expect(store.get('s1')).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it('take consumes the session exactly once', () => {
    const { store } = makeStore();
    store.put('s1', { userId: 'u1', guildId: 'g1', tracks: [fakeTrack] });
    expect(store.take('s1')?.userId).toBe('u1');
    expect(store.take('s1')).toBeUndefined();
    expect(store.get('s1')).toBeUndefined();
  });

  it('sweeps expired sessions on put', () => {
    const { store, advance } = makeStore();
    store.put('old', { userId: 'u1', guildId: 'g1', tracks: [] }, 1_000);
    advance(2_000);
    store.put('new', { userId: 'u2', guildId: 'g1', tracks: [] });
    expect(store.size).toBe(1);
    expect(store.get('new')?.userId).toBe('u2');
  });

  it('returns undefined for unknown ids', () => {
    const { store } = makeStore();
    expect(store.get('nope')).toBeUndefined();
    expect(store.take('nope')).toBeUndefined();
  });
});

describe('SearchSessionStore — capacity (Phase 6, P3)', () => {
  it('evicts the soonest-to-expire sessions beyond the cap', () => {
    let now = 0;
    const store = new SearchSessionStore(() => now);
    for (let i = 0; i < 205; i += 1) {
      now = i; // each insert expires later than the previous
      store.put(`s${i}`, { userId: 'u', guildId: 'g', tracks: [] }, 10_000);
    }
    expect(store.size).toBe(200);
    expect(store.get('s0')).toBeUndefined();
    expect(store.get('s4')).toBeUndefined();
    expect(store.get('s5')).toBeDefined();
    expect(store.get('s204')).toBeDefined();
  });

  it('restore puts a consumed session back with its original expiry', () => {
    const store = new SearchSessionStore(() => 1_000);
    store.put('abc', { userId: 'u', guildId: 'g', tracks: [] }, 5_000);
    const taken = store.take('abc');
    expect(taken).toBeDefined();
    if (taken !== undefined) store.restore('abc', taken);
    expect(store.get('abc')?.expiresAt).toBe(6_000);
  });
});

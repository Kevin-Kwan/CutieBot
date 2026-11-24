import { describe, expect, it } from 'vitest';
import {
  ConversationStore,
  NO_GENERATION,
  estimateApproxTokens,
} from '../../../src/features/ai/history.js';
import type { ChatMessage } from '../../../src/features/ai/history.js';

function makeStore(
  overrides: {
    maxMessages?: number;
    maxApproxTokens?: number;
    ttlMs?: number;
    maxConversations?: number;
    now?: () => number;
  } = {},
): ConversationStore {
  return new ConversationStore({
    maxMessages: 10,
    maxApproxTokens: 100,
    ttlMs: 60_000,
    ...overrides,
  });
}

function message(content: string, role: ChatMessage['role'] = 'user'): ChatMessage {
  return { role, content };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolveFn, rejectFn) => {
    resolve = resolveFn;
    reject = rejectFn;
  });
  return { promise, resolve, reject };
}

describe('ConversationStore — eviction', () => {
  it('evicts oldest messages when maxMessages is exceeded', () => {
    const store = makeStore({ maxMessages: 3 });
    const gen = store.beginTurn('c1');
    for (let i = 1; i <= 5; i += 1) {
      expect(store.append('c1', message(`m${i}`), gen)).toBe(true);
    }
    expect(store.get('c1').map((m) => m.content)).toEqual(['m3', 'm4', 'm5']);
  });

  it('evicts oldest messages when maxApproxTokens is exceeded', () => {
    const store = makeStore({ maxMessages: 100, maxApproxTokens: 10 });
    const gen = store.beginTurn('c1');
    // "aaaa" = 1 token, "aaaaaaaa" = 2 tokens.
    expect(store.append('c1', message('aaaaaaaa'), gen)).toBe(true); // 2
    expect(store.append('c1', message('aaaaaaaa'), gen)).toBe(true); // 4
    expect(store.append('c1', message('aaaaaaaaaaaaaaaa'), gen)).toBe(true); // 8
    expect(store.append('c1', message('aaaaaaaaaaaaaaaa'), gen)).toBe(true); // 12 -> evict oldest -> 10
    const contents = store.get('c1').map((m) => m.content);
    // The cap is a maximum: exactly-at-cap (10) is kept, the same
    // boundary the maxMessages eviction test asserts. (The draft's
    // original expectation evicted down to 8, contradicting that.)
    expect(contents).toEqual(['aaaaaaaa', 'aaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaa']);
    expect(estimateApproxTokens(store.get('c1'))).toBeLessThanOrEqual(10);
    // One more append pushes past the cap and evicts again.
    expect(store.append('c1', message('aaaaaaaa'), gen)).toBe(true); // 12 -> evict -> 10
    expect(store.get('c1').map((m) => m.content)).toEqual([
      'aaaaaaaaaaaaaaaa',
      'aaaaaaaaaaaaaaaa',
      'aaaaaaaa',
    ]);
  });

  // Phase 6 (P1-10): the token cap is a HARD bound — the Phase 5
  // behavior (retain one oversized message whole) was rejected by the
  // audit. A lone oversized message is truncated to fit the budget.
  it('truncates a lone message that alone exceeds the token budget', () => {
    const store = makeStore({ maxMessages: 10, maxApproxTokens: 2 });
    const gen = store.beginTurn('c1');
    expect(store.append('c1', message('short'), gen)).toBe(true);
    const huge = 'x'.repeat(100); // 25 approx tokens
    expect(store.append('c1', message(huge), gen)).toBe(true);
    const stored = store.get('c1');
    expect(stored).toHaveLength(1);
    expect(stored[0]?.content).toBe('x'.repeat(8)); // 2 tokens * 4 chars
    expect(estimateApproxTokens(stored)).toBeLessThanOrEqual(2);
  });

  it('evicts whole turns (user+assistant pairs) where practical', () => {
    const store = makeStore({ maxMessages: 4, maxApproxTokens: 10_000 });
    const gen = store.beginTurn('c1');
    store.append('c1', message('q1', 'user'), gen);
    store.append('c1', message('a1', 'assistant'), gen);
    store.append('c1', message('q2', 'user'), gen);
    store.append('c1', message('a2', 'assistant'), gen);
    store.append('c1', message('q3', 'user'), gen); // over count -> evict q1+a1 together
    expect(store.get('c1').map((m) => m.content)).toEqual(['q2', 'a2', 'q3']);
  });

  it('estimates approx tokens as ceil(length / 4) per message', () => {
    expect(estimateApproxTokens([message('a'), message('abcde')])).toBe(3);
    expect(estimateApproxTokens([])).toBe(0);
  });
});

describe('ConversationStore — TTL', () => {
  it('expires conversations idle longer than ttlMs (fake clock)', () => {
    let nowMs = 1_000;
    const store = makeStore({ ttlMs: 1_000, now: () => nowMs });
    const gen = store.beginTurn('c1');
    expect(store.append('c1', message('hello'), gen)).toBe(true);
    expect(store.get('c1')).toHaveLength(1);
    nowMs += 1_001;
    expect(store.get('c1')).toEqual([]);
    expect(store.currentGeneration('c1')).toBe(NO_GENERATION);
    expect(store.size()).toBe(0);
    // ABA regression (P1-09): the pre-expiry token must stay invalid
    // even after a fresh entry is created for the same id.
    const fresh = store.beginTurn('c1');
    expect(fresh).not.toBe(gen);
    expect(store.append('c1', message('zombie'), gen)).toBe(false);
  });

  it('touch on read extends idle TTL', () => {
    let nowMs = 0;
    const store = makeStore({ ttlMs: 1_000, now: () => nowMs });
    expect(store.append('c1', message('hello'), store.beginTurn('c1'))).toBe(true);
    nowMs = 900;
    expect(store.get('c1')).toHaveLength(1); // touches at t=900
    nowMs = 1_800; // 900ms after the touch: still live (and touches again)
    expect(store.get('c1')).toHaveLength(1);
    nowMs = 2_900; // 1,100ms after the t=1,800 touch: expired
    expect(store.get('c1')).toEqual([]);
  });

  it('sweep() removes only expired conversations and returns the count', () => {
    let nowMs = 0;
    const store = makeStore({ ttlMs: 100, now: () => nowMs });
    expect(store.append('a', message('a'), store.beginTurn('a'))).toBe(true);
    expect(store.append('b', message('b'), store.beginTurn('b'))).toBe(true);
    nowMs = 50;
    expect(store.get('a')).toHaveLength(1); // touch "a" at t=50
    nowMs = 120; // "b" idle 120ms (expired); "a" idle 70ms (live)
    expect(store.sweep()).toBe(1);
    expect(store.size()).toBe(1);
    expect(store.get('a')).toHaveLength(1);
    expect(store.get('b')).toEqual([]);
  });
});

describe('ConversationStore — generation / reset', () => {
  it('drops appends with a stale generation', () => {
    const store = makeStore();
    const gen = store.beginTurn('c1');
    expect(store.append('c1', message('one'), gen)).toBe(true);
    const next = store.reset('c1');
    expect(next).not.toBe(gen);
    expect(store.append('c1', message('stale'), gen)).toBe(false);
    expect(store.get('c1')).toEqual([]);
    expect(store.append('c1', message('fresh'), next)).toBe(true);
    expect(store.get('c1')).toEqual([message('fresh')]);
  });

  it('reset on an unknown id mints a fresh token (tombstone semantics)', () => {
    const store = makeStore();
    expect(store.currentGeneration('new')).toBe(NO_GENERATION);
    const token = store.reset('new');
    expect(token).not.toBe(NO_GENERATION);
    expect(store.currentGeneration('new')).toBe(token);
    expect(store.get('new')).toEqual([]);
  });

  it('generation tokens are never reused across resets', () => {
    const store = makeStore();
    const seen = new Set<string>([store.beginTurn('c1')]);
    for (let i = 0; i < 5; i += 1) {
      const token = store.reset('c1');
      expect(seen.has(token)).toBe(false);
      seen.add(token);
    }
  });

  it('reset during an in-flight enqueue task drops the stale append', async () => {
    const store = makeStore();
    const gate = deferred<void>();
    const gen = store.beginTurn('c1');
    const task = store.enqueue('c1', async () => {
      await gate.promise;
      return store.append('c1', message('late'), gen);
    });
    // Reset while the task is still waiting on the gate.
    store.reset('c1');
    gate.resolve();
    await expect(task).resolves.toBe(false);
    expect(store.get('c1')).toEqual([]);
  });
});

describe('ConversationStore — enqueue', () => {
  it('serializes tasks per key in call order', async () => {
    const store = makeStore();
    const order: string[] = [];
    const first = deferred<void>();
    const second = deferred<void>();
    const p1 = store.enqueue('k', async () => {
      order.push('p1-start');
      await first.promise;
      order.push('p1-end');
      return 1;
    });
    const p2 = store.enqueue('k', async () => {
      order.push('p2-start');
      await second.promise;
      order.push('p2-end');
      return 2;
    });
    // p2 must not start until p1 finishes, even though both were queued.
    await Promise.resolve();
    expect(order).toEqual(['p1-start']);
    first.resolve();
    await expect(p1).resolves.toBe(1);
    await Promise.resolve();
    expect(order).toEqual(['p1-start', 'p1-end', 'p2-start']);
    second.resolve();
    await expect(p2).resolves.toBe(2);
    expect(order).toEqual(['p1-start', 'p1-end', 'p2-start', 'p2-end']);
  });

  it('runs tasks for different keys in parallel', async () => {
    const store = makeStore();
    const gateA = deferred<void>();
    const gateB = deferred<void>();
    const started: string[] = [];
    const pA = store.enqueue('a', async () => {
      started.push('a');
      await gateA.promise;
      return 'a';
    });
    const pB = store.enqueue('b', async () => {
      started.push('b');
      await gateB.promise;
      return 'b';
    });
    await Promise.resolve();
    expect(started).toEqual(['a', 'b']);
    gateA.resolve();
    gateB.resolve();
    await expect(pA).resolves.toBe('a');
    await expect(pB).resolves.toBe('b');
  });

  it('a rejected task does not poison the chain', async () => {
    const store = makeStore();
    await expect(
      store.enqueue('k', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await expect(store.enqueue('k', async () => 'ok')).resolves.toBe('ok');
  });
});

describe('ConversationStore — LRU cap', () => {
  it('evicts the least-recently-used conversation beyond maxConversations', () => {
    // A ticking clock: with the real clock every operation lands in
    // the same millisecond and LRU order degenerates to insertion
    // order, which is not what this test means to assert.
    let tick = 0;
    const store = makeStore({ maxConversations: 2, now: () => ++tick });
    expect(store.append('a', message('a'), store.beginTurn('a'))).toBe(true);
    expect(store.append('b', message('b'), store.beginTurn('b'))).toBe(true);
    expect(store.get('a')).toHaveLength(1); // "a" is now most recently used
    expect(store.append('c', message('c'), store.beginTurn('c'))).toBe(true);
    expect(store.size()).toBe(2);
    expect(store.get('b')).toEqual([]); // LRU evicted
    expect(store.get('a')).toHaveLength(1);
    expect(store.get('c')).toHaveLength(1);
  });
});

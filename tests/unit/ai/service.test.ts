import { describe, expect, it } from 'vitest';
import { createLogger } from '../../../src/core/logger.js';
import { ConversationStore } from '../../../src/features/ai/history.js';
import { DailyUsageLimiter } from '../../../src/features/ai/limits.js';
import type {
  ChatProvider,
  CompleteOptions,
  ProviderMessage,
} from '../../../src/features/ai/provider.js';
import { AiService, MAX_INPUT_CHARS, SYSTEM_PROMPT } from '../../../src/features/ai/service.js';

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

/**
 * Fake chat provider: records every message list it receives, replies
 * from a script (or a custom handler), and can be gated so a call
 * stays in flight until the test releases it. No network.
 */
class FakeProvider implements ChatProvider {
  readonly calls: ProviderMessage[][] = [];
  handler: ((messages: readonly ProviderMessage[], callIndex: number) => Promise<string>) | null =
    null;
  replies: string[] = [];

  async complete(
    messages: readonly ProviderMessage[],
    options?: { signal?: AbortSignal; maxTokens?: number },
  ): Promise<string> {
    void options;
    const snapshot = messages.map((message) => ({ ...message }));
    this.calls.push(snapshot);
    if (this.handler !== null) return this.handler(snapshot, this.calls.length - 1);
    return this.replies.shift() ?? 'fake reply';
  }
}

function makeService(
  overrides: {
    provider?: FakeProvider;
    perUserDaily?: number;
    globalDaily?: number;
    maxInputChars?: number;
  } = {},
): { service: AiService; store: ConversationStore; provider: FakeProvider } {
  const store = new ConversationStore({
    maxMessages: 20,
    maxApproxTokens: 4_000,
    ttlMs: 60_000,
  });
  const provider = overrides.provider ?? new FakeProvider();
  const service = new AiService({
    store,
    limiter: new DailyUsageLimiter({
      perUserDaily: overrides.perUserDaily ?? 100,
      globalDaily: overrides.globalDaily ?? 1_000,
    }),
    provider,
    logger: createLogger('silent'),
    ...(overrides.maxInputChars !== undefined ? { maxInputChars: overrides.maxInputChars } : {}),
  });
  return { service, store, provider };
}

const CONV = 'conv-1';

describe('AiService — history', () => {
  it('appends BOTH turns: the assistant reply is in history for the next call', async () => {
    const { service, store, provider } = makeService();
    provider.replies = ['first answer', 'second answer'];

    await expect(
      service.chat({ conversationId: CONV, userId: 'u1', prompt: 'question one' }),
    ).resolves.toEqual({ kind: 'reply', text: 'first answer' });

    // The legacy bug was that this array only ever held user turns.
    expect(store.get(CONV)).toEqual([
      { role: 'user', content: 'question one' },
      { role: 'assistant', content: 'first answer' },
    ]);

    await service.chat({ conversationId: CONV, userId: 'u1', prompt: 'question two' });
    // The second provider call must see the whole exchange, system first.
    expect(provider.calls[1]).toEqual([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: 'question one' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'question two' },
    ]);
  });

  it('serializes turns per conversation: a queued turn sees the finished exchange', async () => {
    const { service, provider } = makeService();
    const gate = deferred<void>();
    provider.handler = async (_messages, callIndex) => {
      if (callIndex === 0) await gate.promise;
      return `answer ${callIndex}`;
    };
    const first = service.chat({ conversationId: CONV, userId: 'u1', prompt: 'one' });
    const second = service.chat({ conversationId: CONV, userId: 'u1', prompt: 'two' });
    gate.resolve();
    await expect(first).resolves.toEqual({ kind: 'reply', text: 'answer 0' });
    await expect(second).resolves.toEqual({ kind: 'reply', text: 'answer 1' });
    expect(provider.calls[1]).toContainEqual({ role: 'assistant', content: 'answer 0' });
  });

  it('truncates over-long prompts to the input cap before the provider call', async () => {
    const { service, provider } = makeService({ maxInputChars: 10 });
    await service.chat({ conversationId: CONV, userId: 'u1', prompt: 'x'.repeat(50) });
    const userMessage = provider.calls[0]?.at(-1);
    expect(userMessage?.content).toBe('x'.repeat(10));
    expect(MAX_INPUT_CHARS).toBeGreaterThan(0);
  });
});

describe('AiService — reset during flight', () => {
  it('a reset while the provider call is in flight discards the reply and its history write', async () => {
    const { service, store, provider } = makeService();
    const gate = deferred<void>();
    const entered = deferred<void>();
    provider.handler = async () => {
      entered.resolve();
      await gate.promise;
      return 'stale answer';
    };

    const pending = service.chat({ conversationId: CONV, userId: 'u1', prompt: 'hello' });
    await entered.promise; // the provider call is now in flight
    service.reset(CONV); // user resets mid-flight
    gate.resolve();

    await expect(pending).resolves.toEqual({ kind: 'reset' });
    // Neither the stale reply nor the pre-reset question may survive.
    expect(store.get(CONV)).toEqual([]);

    // And the conversation still works afterwards, from a clean slate.
    provider.handler = null;
    provider.replies = ['fresh answer'];
    await expect(
      service.chat({ conversationId: CONV, userId: 'u1', prompt: 'new question' }),
    ).resolves.toEqual({ kind: 'reply', text: 'fresh answer' });
    expect(provider.calls[1]).toEqual([
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: 'new question' },
    ]);
  });
});

describe('AiService — daily caps', () => {
  it('enforces the per-user cap BEFORE the provider call', async () => {
    const { service, provider } = makeService({ perUserDaily: 1 });
    await expect(
      service.chat({ conversationId: CONV, userId: 'u1', prompt: 'one' }),
    ).resolves.toMatchObject({ kind: 'reply' });
    await expect(
      service.chat({ conversationId: CONV, userId: 'u1', prompt: 'two' }),
    ).resolves.toEqual({ kind: 'limited', scope: 'user' });
    expect(provider.calls).toHaveLength(1); // the limited turn never reached the provider
  });

  it('enforces the global cap across users, reported with scope "global"', async () => {
    const { service, provider } = makeService({ perUserDaily: 100, globalDaily: 1 });
    await expect(
      service.chat({ conversationId: CONV, userId: 'u1', prompt: 'one' }),
    ).resolves.toMatchObject({ kind: 'reply' });
    await expect(
      service.chat({ conversationId: 'conv-2', userId: 'u2', prompt: 'two' }),
    ).resolves.toEqual({ kind: 'limited', scope: 'global' });
    expect(provider.calls).toHaveLength(1);
  });

  it('a limited turn appends nothing to history', async () => {
    const { service, store } = makeService({ perUserDaily: 0 });
    await expect(
      service.chat({ conversationId: CONV, userId: 'u1', prompt: 'one' }),
    ).resolves.toMatchObject({ kind: 'limited' });
    expect(store.get(CONV)).toEqual([]);
  });
});

describe('AiService — provider failure', () => {
  it('returns an error outcome and leaves no dangling user turn in history', async () => {
    const { service, store, provider } = makeService();
    provider.handler = async () => {
      throw new Error('provider down');
    };
    await expect(
      service.chat({ conversationId: CONV, userId: 'u1', prompt: 'hello' }),
    ).resolves.toEqual({ kind: 'error' });
    expect(store.get(CONV)).toEqual([]);
  });
});

describe('AiService — conversation ids', () => {
  it('derives per-user ids for /ask and per-channel ids for mention chat', () => {
    expect(AiService.askConversationId('chan-1', 'user-1')).toBe('ask:chan-1:user-1');
    expect(AiService.channelConversationId('chan-1')).toBe('chat:chan-1');
    // Two users in the same channel get separate /ask conversations.
    expect(AiService.askConversationId('chan-1', 'user-2')).not.toBe(
      AiService.askConversationId('chan-1', 'user-1'),
    );
  });
});

describe('AiService — Phase 6 hardening', () => {
  // P2-09: a quota-storage failure must surface as an explicit
  // unavailable outcome — the Phase 5 code let the rejection escape
  // chat() entirely (it documented never-throws and then threw).
  it('returns unavailable (fail closed) when the limiter throws', async () => {
    const store = new ConversationStore({ maxMessages: 20, maxApproxTokens: 4_000, ttlMs: 60_000 });
    const provider = new FakeProvider();
    const service = new AiService({
      store,
      limiter: {
        tryConsume: () => Promise.reject(new Error('mongo unreachable')),
        remaining: () => Promise.resolve(0),
        counts: () => Promise.resolve({ global: 0 }),
      },
      provider,
      logger: createLogger('silent'),
    });
    await expect(
      service.chat({ conversationId: CONV, userId: 'u1', prompt: 'hello' }),
    ).resolves.toEqual({ kind: 'unavailable' });
    expect(provider.calls).toHaveLength(0); // fail CLOSED: no provider call
  });

  // P1-09: the generation token is captured at admission — a reset
  // landing while a turn is still QUEUED (not yet running) must
  // invalidate that turn before it spends quota or calls the provider.
  it('a reset landing while a turn is queued invalidates the queued turn', async () => {
    const { service, provider } = makeService();
    const gate = deferred<void>();
    const entered = deferred<void>();
    provider.handler = async (_messages, callIndex) => {
      if (callIndex === 0) {
        entered.resolve();
        await gate.promise;
      }
      return `answer ${callIndex}`;
    };
    const first = service.chat({ conversationId: CONV, userId: 'u1', prompt: 'one' });
    await entered.promise;
    const second = service.chat({ conversationId: CONV, userId: 'u1', prompt: 'two' });
    service.reset(CONV);
    gate.resolve();
    await expect(first).resolves.toEqual({ kind: 'reset' });
    await expect(second).resolves.toEqual({ kind: 'reset' });
    expect(provider.calls).toHaveLength(1); // the queued turn never called the provider
  });

  // P1-10/G15: reset aborts the in-flight provider call's signal.
  it('reset aborts the in-flight provider call', async () => {
    const { service, provider } = makeService();
    const entered = deferred<void>();
    let seenSignal: AbortSignal | undefined;
    provider.handler = async () => {
      entered.resolve();
      return 'never delivered';
    };
    const original = provider.complete.bind(provider);
    provider.complete = async (messages: readonly ProviderMessage[], options?: CompleteOptions) => {
      seenSignal = options?.signal;
      return original(messages, options);
    };
    const pending = service.chat({ conversationId: CONV, userId: 'u1', prompt: 'hello' });
    await entered.promise;
    service.reset(CONV);
    await expect(pending).resolves.toEqual({ kind: 'reset' });
    expect(seenSignal?.aborted).toBe(true);
  });

  // P1-10: admission is bounded — excess pending turns get 'busy'
  // instead of queueing unboundedly behind a stuck provider.
  it('returns busy when the per-conversation pending bound is reached', async () => {
    const store = new ConversationStore({ maxMessages: 20, maxApproxTokens: 4_000, ttlMs: 60_000 });
    const provider = new FakeProvider();
    const gate = deferred<void>();
    provider.handler = async () => {
      await gate.promise;
      return 'slow answer';
    };
    const service = new AiService({
      store,
      limiter: new DailyUsageLimiter({ perUserDaily: 100, globalDaily: 1_000 }),
      provider,
      logger: createLogger('silent'),
      maxPendingPerConversation: 2,
    });
    const p1 = service.chat({ conversationId: CONV, userId: 'u1', prompt: 'one' });
    const p2 = service.chat({ conversationId: CONV, userId: 'u1', prompt: 'two' });
    await expect(
      service.chat({ conversationId: CONV, userId: 'u1', prompt: 'three' }),
    ).resolves.toEqual({ kind: 'busy' });
    gate.resolve();
    await expect(p1).resolves.toMatchObject({ kind: 'reply' });
    await expect(p2).resolves.toMatchObject({ kind: 'reply' });
  });

  // P1-10: provider calls carry the output-token cap.
  it('passes an output-token cap to the provider', async () => {
    const { service, provider } = makeService();
    let seenMax: number | undefined;
    const original = provider.complete.bind(provider);
    provider.complete = async (messages: readonly ProviderMessage[], options?: CompleteOptions) => {
      seenMax = options?.maxTokens;
      return original(messages, options);
    };
    await service.chat({ conversationId: CONV, userId: 'u1', prompt: 'hello' });
    expect(seenMax).toBeGreaterThan(0);
  });
});

// Phase 6c (deadline-awareness + semaphore handoff): every wait
// respects the deadline; a deadline expiry is 'error', NOT 'reset';
// the semaphore is FIFO with direct permit handoff.
describe('AiService — Phase 6c deadline + semaphore', () => {
  function directService(overrides: {
    provider: FakeProvider;
    deadlineMs?: number;
    maxConcurrentProvider?: number;
    limiter?: {
      tryConsume: () => Promise<never>;
      remaining: () => Promise<number>;
      counts: () => Promise<{ global: number }>;
    };
  }): AiService {
    return new AiService({
      store: new ConversationStore({ maxMessages: 20, maxApproxTokens: 4_000, ttlMs: 60_000 }),
      limiter:
        overrides.limiter ?? new DailyUsageLimiter({ perUserDaily: 100, globalDaily: 1_000 }),
      provider: overrides.provider,
      logger: createLogger('silent'),
      ...(overrides.deadlineMs !== undefined ? { deadlineMs: overrides.deadlineMs } : {}),
      ...(overrides.maxConcurrentProvider !== undefined
        ? { maxConcurrentProvider: overrides.maxConcurrentProvider }
        : {}),
    });
  }

  it('a turn stuck in the ENQUEUE wait past its deadline returns error, not reset', async () => {
    const provider = new FakeProvider();
    const gate = deferred<void>();
    const entered = deferred<void>();
    provider.handler = async (_messages, callIndex) => {
      if (callIndex === 0) {
        entered.resolve();
        await gate.promise;
      }
      return `answer ${callIndex}`;
    };
    const service = directService({ provider, deadlineMs: 150 });
    const first = service.chat({ conversationId: CONV, userId: 'u1', prompt: 'one' });
    await entered.promise;
    const second = service.chat({ conversationId: CONV, userId: 'u1', prompt: 'two' });
    // The queued turn's deadline expires while it waits: 'error',
    // NOT the 'reset' the Phase 6 code would eventually have produced.
    await expect(second).resolves.toEqual({ kind: 'error' });
    // The first turn ALSO blew its own deadline mid-provider-call
    // (in production the provider call aborts on the same signal).
    await expect(first).resolves.toEqual({ kind: 'error' });
    gate.resolve();
    // The queue is not poisoned: a fresh turn runs normally, and the
    // expired queued turn never spent a provider call of its own.
    await expect(
      service.chat({ conversationId: CONV, userId: 'u1', prompt: 'three' }),
    ).resolves.toMatchObject({ kind: 'reply' });
    expect(provider.calls).toHaveLength(2);
  });

  it('a turn stuck in the SEMAPHORE wait past its deadline returns error and frees its place', async () => {
    const provider = new FakeProvider();
    const gate = deferred<void>();
    const entered = deferred<void>();
    provider.handler = async (_messages, callIndex) => {
      if (callIndex === 0) {
        entered.resolve();
        await gate.promise;
      }
      return `answer ${callIndex}`;
    };
    const service = directService({ provider, deadlineMs: 150, maxConcurrentProvider: 1 });
    const first = service.chat({ conversationId: 'conv-a', userId: 'u1', prompt: 'one' });
    await entered.promise;
    const second = service.chat({ conversationId: 'conv-b', userId: 'u2', prompt: 'two' });
    await expect(second).resolves.toEqual({ kind: 'error' });
    await expect(first).resolves.toEqual({ kind: 'error' }); // blew its deadline in the provider call
    gate.resolve();
    // The cancelled waiter was REMOVED from the semaphore queue: once
    // the holder's slot frees, a third turn proceeds normally.
    await expect(
      service.chat({ conversationId: 'conv-c', userId: 'u3', prompt: 'three' }),
    ).resolves.toMatchObject({ kind: 'reply' });
    expect(provider.calls).toHaveLength(2);
  });

  it('a turn stuck in the LIMITER call past its deadline returns error, not reset', async () => {
    const provider = new FakeProvider();
    const service = directService({
      provider,
      deadlineMs: 100,
      limiter: {
        tryConsume: () => new Promise<never>(() => undefined),
        remaining: () => Promise.resolve(0),
        counts: () => Promise.resolve({ global: 0 }),
      },
    });
    await expect(
      service.chat({ conversationId: CONV, userId: 'u1', prompt: 'hello' }),
    ).resolves.toEqual({ kind: 'error' });
    expect(provider.calls).toHaveLength(0);
  });

  it('the semaphore hands off FIFO: a later arrival cannot barge ahead of a queued waiter', async () => {
    const provider = new FakeProvider();
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()];
    const entered = [deferred<void>(), deferred<void>(), deferred<void>()];
    provider.handler = async (_messages, callIndex) => {
      entered[callIndex]?.resolve();
      await gates[callIndex]?.promise;
      return `answer ${callIndex}`;
    };
    const service = directService({ provider, maxConcurrentProvider: 1 });
    const order: string[] = [];
    const track = (promise: Promise<{ kind: string }>, label: string): Promise<{ kind: string }> =>
      promise.then((outcome) => {
        order.push(label);
        return outcome;
      });
    const a = track(service.chat({ conversationId: 'c-a', userId: 'u1', prompt: 'A' }), 'A');
    await entered[0]?.promise;
    const b = track(service.chat({ conversationId: 'c-b', userId: 'u2', prompt: 'B' }), 'B');
    // Let B reach the semaphore queue, then C arrives behind it.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const c = track(service.chat({ conversationId: 'c-c', userId: 'u3', prompt: 'C' }), 'C');
    await new Promise((resolve) => setTimeout(resolve, 20));
    gates[0]?.resolve();
    await entered[1]?.promise; // B got the handoff and is in the provider
    expect(provider.calls).toHaveLength(2); // C has NOT barged in
    gates[1]?.resolve();
    await entered[2]?.promise;
    gates[2]?.resolve();
    await Promise.all([a, b, c]);
    expect(order).toEqual(['A', 'B', 'C']);
  });
});

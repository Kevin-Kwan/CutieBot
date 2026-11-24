import type { AppContext } from '../../core/context.js';
import { serializeError } from '../../core/errors.js';
import type { AppLogger } from '../../core/logger.js';
import { ConversationStore } from './history.js';
import { type LimitScope, type UsageLimiter } from './limits.js';
import { MongoUsageLimiter } from './limits.mongo.js';
import {
  createChatProvider,
  DEFAULT_MAX_COMPLETION_TOKENS,
  type ChatProvider,
  type ProviderMessage,
} from './provider.js';

/**
 * Conversation service (PLAN §8) — orchestrates store + limiter +
 * provider for one chat turn:
 *
 *   admission: capture the generation token + a pending slot
 *     → enqueue (serialized per conversation)
 *     → consume daily quota BEFORE any provider call
 *     → re-check the generation (a reset may have landed meanwhile)
 *     → read history, call the provider with [system, ...history, user]
 *       under an end-to-end deadline / reset abort signal and an
 *       output-token cap
 *     → append BOTH turns under the admission generation token
 *
 * The legacy bot kept one unbounded global history, never appended the
 * assistant's replies (so the model never saw its own answers), and had
 * no quota at all (AUDIT §2.4, §6.5). Here both appends happen or
 * neither does: if a reset landed while the provider call was in
 * flight, the generation check fails, the reply is discarded, and the
 * caller is told the turn was reset — a stale reply is never delivered
 * or written into the fresh conversation.
 *
 * Phase 6 hardening (AUDIT6 P1-09 / P1-10 / P2-09 / G15):
 * - generation tokens are non-reusable and captured at ADMISSION, not
 *   when the serialized task starts (a reset landing while a turn is
 *   queued is now visible to it);
 * - reset() aborts in-flight provider calls via AbortController;
 * - quota-storage failure returns an explicit 'unavailable' outcome —
 *   the limiter fails CLOSED, never open, and never throws out of
 *   chat() (the Phase 5 code let a limiter rejection escape, breaking
 *   the documented never-throws contract);
 * - admission is bounded: per-conversation and global pending limits,
 *   a provider concurrency semaphore, an end-to-end deadline, and a
 *   per-reply output-token cap complete the cost circuit breaker
 *   alongside the (now env-configured) daily caps.
 *
 * Phase 6c (deadline-awareness): every WAIT a turn can sit in now
 * respects the deadline — the per-conversation enqueue wait, the
 * provider-semaphore wait, and the limiter call are all raced against
 * the turn's abort signal, and a deadline expiry reports kind 'error'
 * (a stale generation still reports 'reset', checked first). The
 * semaphore hands its permit directly to the next waiter (FIFO, no
 * barge-in). What the deadline cannot do: cancel an already-running
 * Mongo limiter transaction or provider request mid-flight from here
 * — those are abandoned and their results discarded (the provider
 * call itself receives the signal and aborts at the HTTP layer).
 */

/** The bot's persona — one definition, used for every conversation. */
export const SYSTEM_PROMPT =
  'You are CutieBot, a friendly and helpful assistant in a Discord server. ' +
  'Chat casually, answer questions, and keep replies concise unless the user asks for detail. ' +
  'You may use Markdown; put code in fenced code blocks. Never claim to be human.';

/** Bounded-history settings (PLAN §8: count + approx-token caps, idle TTL). */
export const HISTORY_MAX_MESSAGES = 20;
export const HISTORY_MAX_APPROX_TOKENS = 4_000;
export const HISTORY_TTL_MS = 30 * 60 * 1_000;

/** Prompts longer than this are truncated before they reach the provider. */
export const MAX_INPUT_CHARS = 4_000;

/** End-to-end deadline for one admitted turn, queue wait included. */
export const AI_REQUEST_DEADLINE_MS = 60_000;
/** Max admitted-but-unfinished turns per conversation / globally. */
export const AI_MAX_PENDING_PER_CONVERSATION = 3;
export const AI_MAX_PENDING_GLOBAL = 32;
/** Max simultaneous provider calls across all conversations. */
export const AI_MAX_CONCURRENT_PROVIDER = 4;

export type ChatOutcome =
  | { readonly kind: 'reply'; readonly text: string }
  | { readonly kind: 'limited'; readonly scope: LimitScope }
  | { readonly kind: 'reset' }
  | { readonly kind: 'error' }
  /** Quota storage failed — AI is down, fail closed (P2-09). */
  | { readonly kind: 'unavailable' }
  /** Admission bounds reached — too many turns already in flight (P1-10). */
  | { readonly kind: 'busy' };

/** The slice of the service the message handler depends on (test seam). */
export interface AiTriggerService {
  chat(input: { conversationId: string; userId: string; prompt: string }): Promise<ChatOutcome>;
  reset(conversationId: string): void;
}

export interface AiServiceDeps {
  readonly store: ConversationStore;
  readonly limiter: UsageLimiter;
  readonly provider: ChatProvider;
  readonly logger: AppLogger;
  readonly systemPrompt?: string;
  readonly maxInputChars?: number;
  readonly deadlineMs?: number;
  readonly maxPendingPerConversation?: number;
  readonly maxPendingGlobal?: number;
  readonly maxConcurrentProvider?: number;
  readonly maxCompletionTokens?: number;
}

export class AiService {
  private readonly store: ConversationStore;
  private readonly limiter: UsageLimiter;
  private readonly provider: ChatProvider;
  private readonly logger: AppLogger;
  private readonly systemPrompt: string;
  private readonly maxInputChars: number;
  private readonly deadlineMs: number;
  private readonly maxPendingPerConversation: number;
  private readonly maxPendingGlobal: number;
  private readonly maxConcurrentProvider: number;
  private readonly maxCompletionTokens: number;

  private readonly pendingByConversation = new Map<string, number>();
  private pendingGlobal = 0;
  private readonly inFlight = new Map<string, Set<AbortController>>();
  private providerInFlight = 0;
  private readonly providerWaiters: ProviderWaiter[] = [];

  constructor(deps: AiServiceDeps) {
    this.store = deps.store;
    this.limiter = deps.limiter;
    this.provider = deps.provider;
    this.logger = deps.logger;
    this.systemPrompt = deps.systemPrompt ?? SYSTEM_PROMPT;
    this.maxInputChars = deps.maxInputChars ?? MAX_INPUT_CHARS;
    this.deadlineMs = deps.deadlineMs ?? AI_REQUEST_DEADLINE_MS;
    this.maxPendingPerConversation =
      deps.maxPendingPerConversation ?? AI_MAX_PENDING_PER_CONVERSATION;
    this.maxPendingGlobal = deps.maxPendingGlobal ?? AI_MAX_PENDING_GLOBAL;
    this.maxConcurrentProvider = deps.maxConcurrentProvider ?? AI_MAX_CONCURRENT_PROVIDER;
    this.maxCompletionTokens = deps.maxCompletionTokens ?? DEFAULT_MAX_COMPLETION_TOKENS;
  }

  /** /ask conversations are per user+channel (PLAN §8). */
  static askConversationId(channelId: string, userId: string): string {
    return `ask:${channelId}:${userId}`;
  }

  /** Mention/reply conversations are per channel (PLAN §8). */
  static channelConversationId(channelId: string): string {
    return `chat:${channelId}`;
  }

  /** Run one chat turn. Never throws for provider/limiter failures. */
  async chat(input: {
    conversationId: string;
    userId: string;
    prompt: string;
  }): Promise<ChatOutcome> {
    const { conversationId, userId } = input;
    const prompt = input.prompt.slice(0, this.maxInputChars);

    // Admission (P1-09): the generation token is captured NOW — when
    // the request is accepted — not when the serialized task starts.
    const token = this.store.beginTurn(conversationId);
    if (!this.acquirePending(conversationId)) {
      return { kind: 'busy' };
    }
    const controller = new AbortController();
    this.registerInFlight(conversationId, controller);
    const deadline = setTimeout(() => {
      controller.abort();
    }, this.deadlineMs);
    deadline.unref();
    try {
      // Phase 6c (deadline-awareness): the enqueue WAIT is raced
      // against the turn's abort signal — the Phase 6 code awaited
      // the queue unconditionally, so a turn stuck behind a slow
      // conversation only learned about its own deadline when it
      // finally ran (and then misreported it as 'reset'). On abort,
      // the generation check decides the kind FIRST (Gemini): a stale
      // generation means a reset landed ('reset'); a still-current
      // generation means the deadline expired ('error'). The queued
      // task still runs later and exits immediately at runTurn's
      // first check — its outcome is discarded here.
      const enqueued = this.store.enqueue(conversationId, () =>
        this.runTurn(conversationId, userId, prompt, token, controller),
      );
      return await new Promise<ChatOutcome>((resolve, reject) => {
        const onAbort = (): void => {
          resolve(
            this.store.isCurrent(conversationId, token) ? { kind: 'error' } : { kind: 'reset' },
          );
        };
        if (controller.signal.aborted) {
          onAbort();
          return;
        }
        controller.signal.addEventListener('abort', onAbort, { once: true });
        enqueued.then(
          (outcome) => {
            controller.signal.removeEventListener('abort', onAbort);
            resolve(outcome);
          },
          (error: unknown) => {
            controller.signal.removeEventListener('abort', onAbort);
            reject(error instanceof Error ? error : new Error(String(error)));
          },
        );
      });
    } finally {
      clearTimeout(deadline);
      this.unregisterInFlight(conversationId, controller);
      this.releasePending(conversationId);
    }
  }

  private async runTurn(
    conversationId: string,
    userId: string,
    prompt: string,
    token: string,
    controller: AbortController,
  ): Promise<ChatOutcome> {
    // Phase 6c (deadline-awareness, Gemini's ordering): the generation
    // check decides 'reset' FIRST; an aborted-but-current turn is a
    // DEADLINE expiry and reports 'error'. The Phase 6 code lumped
    // both into 'reset', so deadline-killed turns were misreported as
    // resets (and a reset's caller could not tell them apart).
    if (!this.store.isCurrent(conversationId, token)) {
      return { kind: 'reset' };
    }
    if (controller.signal.aborted) {
      return { kind: 'error' };
    }

    // The limiter call is raced against the deadline (Phase 6c): the
    // wait is ABANDONED at the deadline and its result discarded. An
    // already-running Mongo limiter transaction cannot be cancelled
    // mid-flight from the client — it settles on its own and nobody
    // reads the result.
    let consume;
    try {
      const raced = await raceAbort(this.limiter.tryConsume(userId), controller.signal);
      if (raced === ABORTED) {
        return this.store.isCurrent(conversationId, token) ? { kind: 'error' } : { kind: 'reset' };
      }
      consume = raced;
    } catch (error) {
      // P2-09: quota-storage failure is an explicit unavailable
      // outcome — fail closed, never throw out of chat().
      this.logger.error(
        { err: serializeError(error), userId },
        'AI usage limiter failed; refusing chat (fail closed)',
      );
      return { kind: 'unavailable' };
    }
    if (!consume.allowed) {
      this.logger.info(
        { userId, scope: consume.scope ?? 'user' },
        'AI chat refused by daily usage cap',
      );
      return { kind: 'limited', scope: consume.scope ?? 'user' };
    }

    // G15: re-check the generation after consuming quota — a reset
    // during the limiter call must not let this turn write into the
    // fresh conversation.
    if (!this.store.isCurrent(conversationId, token)) {
      return { kind: 'reset' };
    }
    if (controller.signal.aborted) {
      return { kind: 'error' };
    }

    const history = this.store.get(conversationId);
    const messages: ProviderMessage[] = [
      { role: 'system', content: this.systemPrompt },
      ...history,
      { role: 'user', content: prompt },
    ];

    let reply: string;
    try {
      reply = await this.withProviderSlot(controller.signal, async () => {
        if (controller.signal.aborted) throw new Error('AI turn aborted');
        return this.provider.complete(messages, {
          signal: controller.signal,
          maxTokens: this.maxCompletionTokens,
        });
      });
    } catch (error) {
      if (!this.store.isCurrent(conversationId, token)) return { kind: 'reset' };
      // A deadline expiry (including a semaphore wait abandoned at
      // the deadline) is an 'error' outcome, not a provider failure —
      // and not worth an error-level log line.
      if (controller.signal.aborted) return { kind: 'error' };
      this.logger.error({ err: serializeError(error), userId }, 'AI provider call failed');
      return { kind: 'error' };
    }

    // Append both turns under the admission generation. A reset (or
    // TTL expiry) during the provider call invalidates the write —
    // and the reply with it.
    const userAppended = this.store.append(
      conversationId,
      { role: 'user', content: prompt },
      token,
    );
    if (!userAppended) return { kind: 'reset' };
    const assistantAppended = this.store.append(
      conversationId,
      { role: 'assistant', content: reply },
      token,
    );
    if (!assistantAppended) return { kind: 'reset' };
    return { kind: 'reply', text: reply };
  }

  /** Reset a conversation: clears history and aborts in-flight turns. */
  reset(conversationId: string): void {
    this.store.reset(conversationId);
    const controllers = this.inFlight.get(conversationId);
    if (controllers !== undefined) {
      for (const controller of controllers) controller.abort();
    }
  }

  private acquirePending(conversationId: string): boolean {
    const perConversation = this.pendingByConversation.get(conversationId) ?? 0;
    if (perConversation >= this.maxPendingPerConversation) return false;
    if (this.pendingGlobal >= this.maxPendingGlobal) return false;
    this.pendingByConversation.set(conversationId, perConversation + 1);
    this.pendingGlobal += 1;
    return true;
  }

  private releasePending(conversationId: string): void {
    const perConversation = this.pendingByConversation.get(conversationId) ?? 0;
    if (perConversation <= 1) this.pendingByConversation.delete(conversationId);
    else this.pendingByConversation.set(conversationId, perConversation - 1);
    this.pendingGlobal = Math.max(0, this.pendingGlobal - 1);
  }

  private registerInFlight(conversationId: string, controller: AbortController): void {
    let set = this.inFlight.get(conversationId);
    if (set === undefined) {
      set = new Set();
      this.inFlight.set(conversationId, set);
    }
    set.add(controller);
  }

  private unregisterInFlight(conversationId: string, controller: AbortController): void {
    const set = this.inFlight.get(conversationId);
    if (set === undefined) return;
    set.delete(controller);
    if (set.size === 0) this.inFlight.delete(conversationId);
  }

  /**
   * Provider concurrency semaphore (P1-10), rebuilt in Phase 6c:
   * - FIFO with DIRECT PERMIT HANDOFF — when a call finishes, its
   *   slot transfers straight to the longest-waiting turn (the count
   *   does not dip), so a NEW arrival can never barge ahead of queued
   *   waiters; the Phase 6 decrement-then-wake shape let a new
   *   arrival claim the dipped slot first, over-admitting past the
   *   cap when the woken waiter then incremented too;
   * - deadline-aware — the wait races the turn's abort signal, and a
   *   cancelled waiter is REMOVED from the queue (the Phase 6 wait
   *   had no signal at all: a deadline-killed turn held its place in
   *   line and then ran its provider call on an aborted signal).
   */
  private async withProviderSlot<T>(signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
    if (this.providerWaiters.length === 0 && this.providerInFlight < this.maxConcurrentProvider) {
      this.providerInFlight += 1;
    } else {
      await this.waitForProviderSlot(signal);
    }
    try {
      return await fn();
    } finally {
      this.releaseProviderSlot();
    }
  }

  /** Wait for a handed-off slot; rejects (and dequeues) on abort. */
  private waitForProviderSlot(signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('AI turn aborted while waiting for a provider slot'));
        return;
      }
      const waiter: ProviderWaiter = {
        signal,
        resolve: () => {
          signal.removeEventListener('abort', waiter.onAbort);
          resolve();
        },
        reject,
        onAbort: () => {
          const index = this.providerWaiters.indexOf(waiter);
          if (index !== -1) this.providerWaiters.splice(index, 1);
          reject(new Error('AI turn aborted while waiting for a provider slot'));
        },
      };
      signal.addEventListener('abort', waiter.onAbort, { once: true });
      this.providerWaiters.push(waiter);
    });
  }

  private releaseProviderSlot(): void {
    const next = this.providerWaiters.shift();
    if (next === undefined) {
      this.providerInFlight -= 1;
      return;
    }
    // Direct handoff: the slot transfers — providerInFlight is
    // unchanged, and no new arrival can slip into the gap.
    next.resolve();
  }
}

interface ProviderWaiter {
  readonly signal: AbortSignal;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  readonly onAbort: () => void;
}

/** Sentinel for "the abort signal won the race" (raceAbort). */
const ABORTED: unique symbol = Symbol('ai-turn-aborted');

/**
 * Race a promise against an AbortSignal: resolves with the promise's
 * value, or ABORTED the moment the signal fires. The losing promise
 * keeps its handlers (no unhandled rejection); its eventual result is
 * simply never read.
 */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T | typeof ABORTED> {
  if (signal.aborted) return Promise.resolve(ABORTED);
  return new Promise<T | typeof ABORTED>((resolve, reject) => {
    const onAbort = (): void => resolve(ABORTED);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Production wiring. The ConversationStore is in-memory state, so the
 * service is built once per AppContext and memoized — rebuilding per
 * invocation (the economy pattern, fine for a stateless repo) would
 * wipe every conversation. Returns null when no OpenAI key is
 * configured: the feature degrades instead of blocking boot (§11).
 * Tests build AiService directly, or seed one via setAiService.
 */
const services = new WeakMap<AppContext, AiService | null>();

export function getAiService(ctx: AppContext): AiService | null {
  const existing = services.get(ctx);
  if (existing !== undefined) return existing;
  const provider = createChatProvider(ctx.config);
  const service =
    provider === null
      ? null
      : new AiService({
          store: new ConversationStore({
            maxMessages: HISTORY_MAX_MESSAGES,
            maxApproxTokens: HISTORY_MAX_APPROX_TOKENS,
            ttlMs: HISTORY_TTL_MS,
          }),
          // Daily caps come from operator config (Phase 6, ruling 2).
          limiter: new MongoUsageLimiter(ctx.db, {
            perUserDaily: ctx.config.aiPerUserDailyCap,
            globalDaily: ctx.config.aiGlobalDailyCap,
          }),
          provider,
          logger: ctx.logger,
        });
  services.set(ctx, service);
  return service;
}

/** Test/bootstrap seam: pre-seed the service (or its absence) for a context. */
export function setAiService(ctx: AppContext, service: AiService | null): void {
  services.set(ctx, service);
}

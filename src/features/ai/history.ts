/**
 * Pure conversation history for CutieBot v3's AI chat (Phase 5).
 *
 * No discord.js / OpenAI imports: this module only stores, evicts, expires
 * and serialises access to plain `{ role, content }` messages.
 *
 * Invariants
 * - Approx tokens: `ceil(content.length / 4)` per message, summed.
 * - The token cap is a HARD bound (Phase 6, AUDIT6 P1-10): a single
 *   message larger than the whole budget is truncated to fit on
 *   append, never retained whole. (Phase 5 kept it whole; GPT's audit
 *   rejected that — a cap that is not a bound is not a cap.)
 * - Eviction removes whole turns (user+assistant pairs) where
 *   practical, so history does not begin mid-turn (P3).
 * - TTL is idle time: every successful read/append touches `lastAccessMs`.
 * - Generations are NON-REUSABLE TOKENS (Phase 6, P1-09): each entry
 *   carries a random token, rotated by `reset()` and by entry
 *   creation. The old numeric counter had an ABA hole — a missing or
 *   expired entry reported generation 0, exactly the generation a
 *   freshly created entry started with, so a stale in-flight turn
 *   could append into (and answer from) a brand-new conversation.
 *   A stale `append()` (token != current) is dropped, returns `false`.
 */

import { randomUUID } from 'node:crypto';

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  readonly role: ChatRole;
  readonly content: string;
}

export interface ConversationStoreOptions {
  readonly maxMessages: number;
  readonly maxApproxTokens: number;
  readonly ttlMs: number;
  readonly maxConversations?: number;
  readonly now?: () => number;
}

interface ConversationEntry {
  messages: ChatMessage[];
  approxTokens: number;
  /** Non-reusable generation token (see header). */
  generation: string;
  lastAccessMs: number;
}

/** Token reported for a conversation with no live entry; never matches. */
export const NO_GENERATION = 'no-live-conversation';

const DEFAULT_MAX_CONVERSATIONS = 1_000;

export function estimateApproxTokens(messages: readonly ChatMessage[]): number {
  let total = 0;
  for (const message of messages) {
    total += Math.ceil(message.content.length / 4);
  }
  return total;
}

export class ConversationStore {
  private readonly maxMessages: number;
  private readonly maxApproxTokens: number;
  private readonly ttlMs: number;
  private readonly maxConversations: number;
  private readonly now: () => number;
  private readonly conversations = new Map<string, ConversationEntry>();
  private readonly queues = new Map<string, Promise<unknown>>();

  public constructor(options: ConversationStoreOptions) {
    if (!Number.isFinite(options.maxMessages) || options.maxMessages < 1) {
      throw new RangeError('maxMessages must be a finite number >= 1');
    }
    if (!Number.isFinite(options.maxApproxTokens) || options.maxApproxTokens < 1) {
      throw new RangeError('maxApproxTokens must be a finite number >= 1');
    }
    if (!Number.isFinite(options.ttlMs) || options.ttlMs < 0) {
      throw new RangeError('ttlMs must be a finite number >= 0');
    }
    if (
      options.maxConversations !== undefined &&
      (!Number.isFinite(options.maxConversations) || options.maxConversations < 1)
    ) {
      throw new RangeError('maxConversations must be a finite number >= 1');
    }
    this.maxMessages = options.maxMessages;
    this.maxApproxTokens = options.maxApproxTokens;
    this.ttlMs = options.ttlMs;
    this.maxConversations = options.maxConversations ?? DEFAULT_MAX_CONVERSATIONS;
    this.now = options.now ?? Date.now;
  }

  public append(id: string, message: ChatMessage, generation: string): boolean {
    const entry = this.getOrCreateLive(id);
    if (entry.generation !== generation) {
      return false;
    }
    entry.messages.push(message);
    entry.approxTokens += Math.ceil(message.content.length / 4);
    entry.lastAccessMs = this.now();
    this.evict(entry);
    return true;
  }

  public get(id: string): readonly ChatMessage[] {
    const entry = this.getLive(id);
    if (entry === undefined) {
      return [];
    }
    entry.lastAccessMs = this.now();
    return [...entry.messages];
  }

  /**
   * Capture the conversation's current generation token at ADMISSION
   * time (Phase 6, P1-09 — the token must be taken when the request is
   * accepted, not when the serialized task eventually starts, or a
   * reset that lands while the task queues up is invisible to it).
   * Creates the entry if needed. The returned token is what append()
   * and isCurrent() check against.
   */
  public beginTurn(id: string): string {
    const entry = this.getOrCreateLive(id);
    entry.lastAccessMs = this.now();
    return entry.generation;
  }

  /** True when `generation` is still the conversation's live token. */
  public isCurrent(id: string, generation: string): boolean {
    const entry = this.getLive(id);
    return entry !== undefined && entry.generation === generation;
  }

  public reset(id: string): string {
    const entry = this.getOrCreateLive(id);
    entry.messages = [];
    entry.approxTokens = 0;
    entry.generation = randomUUID();
    entry.lastAccessMs = this.now();
    return entry.generation;
  }

  public currentGeneration(id: string): string {
    const entry = this.getLive(id);
    return entry === undefined ? NO_GENERATION : entry.generation;
  }

  public size(): number {
    this.sweepExpired();
    return this.conversations.size;
  }

  public sweep(): number {
    return this.sweepExpired();
  }

  public async enqueue<T>(id: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(id) ?? Promise.resolve();
    const run: Promise<T> = previous.then(task, task);
    const tracked: Promise<unknown> = run.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(id, tracked);
    try {
      return await run;
    } finally {
      if (this.queues.get(id) === tracked) {
        this.queues.delete(id);
      }
    }
  }

  private evict(entry: ConversationEntry): void {
    while (entry.messages.length > 1) {
      const withinCount = entry.messages.length <= this.maxMessages;
      const withinTokens = entry.approxTokens <= this.maxApproxTokens;
      if (withinCount && withinTokens) {
        break;
      }
      // Evict whole turns where practical (P3): when the front is a
      // user+assistant pair with more history behind it, drop both so
      // the retained history never opens with an orphaned assistant
      // message answering a question that is no longer there.
      const first = entry.messages[0];
      const second = entry.messages[1];
      if (
        first !== undefined &&
        second !== undefined &&
        first.role === 'user' &&
        second.role === 'assistant' &&
        entry.messages.length > 2
      ) {
        entry.messages.splice(0, 2);
        entry.approxTokens -=
          Math.ceil(first.content.length / 4) + Math.ceil(second.content.length / 4);
        continue;
      }
      if (first === undefined) break;
      entry.messages.shift();
      entry.approxTokens -= Math.ceil(first.content.length / 4);
    }
    // Hard token bound (P1-10): one message may not exceed the whole
    // budget. Truncate the survivor to fit — the cap is a bound, not
    // a suggestion.
    if (entry.messages.length === 1 && entry.approxTokens > this.maxApproxTokens) {
      const only = entry.messages[0];
      if (only !== undefined) {
        const maxChars = this.maxApproxTokens * 4;
        if (only.content.length > maxChars) {
          entry.messages[0] = { role: only.role, content: only.content.slice(0, maxChars) };
          entry.approxTokens = Math.ceil(maxChars / 4);
        }
      }
    }
  }

  private isExpired(entry: ConversationEntry, nowMs: number): boolean {
    return nowMs - entry.lastAccessMs > this.ttlMs;
  }

  private getLive(id: string): ConversationEntry | undefined {
    const entry = this.conversations.get(id);
    if (entry === undefined) {
      return undefined;
    }
    if (this.isExpired(entry, this.now())) {
      this.conversations.delete(id);
      return undefined;
    }
    return entry;
  }

  private getOrCreateLive(id: string): ConversationEntry {
    const existing = this.getLive(id);
    if (existing !== undefined) {
      return existing;
    }
    const entry: ConversationEntry = {
      messages: [],
      approxTokens: 0,
      generation: randomUUID(),
      lastAccessMs: this.now(),
    };
    this.conversations.set(id, entry);
    this.evictLeastRecentlyUsed();
    return entry;
  }

  private evictLeastRecentlyUsed(): void {
    while (this.conversations.size > this.maxConversations) {
      let oldestId: string | undefined;
      let oldestAccess = Number.POSITIVE_INFINITY;
      for (const [candidateId, candidate] of this.conversations) {
        if (candidate.lastAccessMs < oldestAccess) {
          oldestAccess = candidate.lastAccessMs;
          oldestId = candidateId;
        }
      }
      if (oldestId === undefined) {
        break;
      }
      this.conversations.delete(oldestId);
    }
  }

  private sweepExpired(): number {
    const nowMs = this.now();
    let removed = 0;
    for (const [id, entry] of [...this.conversations]) {
      if (this.isExpired(entry, nowMs)) {
        this.conversations.delete(id);
        removed += 1;
      }
    }
    return removed;
  }
}

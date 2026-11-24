import OpenAI from 'openai';
import type { AppConfig } from '../../config/env.js';
import { TrustedMessageError } from '../../core/errors.js';

/**
 * Chat provider adapter (PLAN §8).
 *
 * Feature code talks to this small interface only — the OpenAI SDK
 * (v7, pinned) lives behind it, so the provider or model can be swapped
 * without touching the conversation service, commands, or message
 * handler. The legacy bot called the v3 SDK inline from index.js with
 * the model, temperature, and token cap hardcoded (AUDIT §2.4); here
 * the model comes from config (OPENAI_MODEL) and the SDK is configured
 * with the plan's reliability bounds: ~30 s timeout, maxRetries 1.
 */

export type ProviderRole = 'system' | 'user' | 'assistant';

export interface ProviderMessage {
  readonly role: ProviderRole;
  readonly content: string;
}

export interface CompleteOptions {
  /** Aborts the provider call (reset / end-to-end deadline). */
  readonly signal?: AbortSignal;
  /** Hard cap on generated tokens for this call. */
  readonly maxTokens?: number;
}

export interface ChatProvider {
  /** Send a full message list; resolves with the assistant's reply text. */
  complete(messages: readonly ProviderMessage[], options?: CompleteOptions): Promise<string>;
}

/** Raised for provider-side failures (network, API error, empty reply). */
export class AiProviderError extends TrustedMessageError {
  constructor(message: string) {
    super(message);
    this.name = 'AiProviderError';
  }
}

export const PROVIDER_TIMEOUT_MS = 30_000;
export const PROVIDER_MAX_RETRIES = 1;
/**
 * Default output-token cap per reply (Phase 6, AUDIT6 P1-10): the daily
 * request caps alone are not a cost circuit breaker while a single
 * reply can generate unbounded output.
 */
export const DEFAULT_MAX_COMPLETION_TOKENS = 1_024;

/**
 * The minimal slice of the OpenAI client this adapter uses. The real
 * SDK client satisfies it structurally (our plain { model, messages }
 * shape is a valid member of its generated params union), so no cast
 * is needed. Tests inject a fake with this shape — no network
 * anywhere near the test suite.
 */
export interface OpenAiClientLike {
  readonly chat: {
    readonly completions: {
      create(
        params: {
          model: string;
          messages: { role: ProviderRole; content: string }[];
          max_completion_tokens: number;
        },
        options?: { signal?: AbortSignal },
      ): Promise<{
        choices: readonly { message: { content: string | null } }[];
      }>;
    };
  };
}

export interface OpenAiProviderOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  /** Test seam: inject a fake client instead of constructing the SDK. */
  readonly client?: OpenAiClientLike;
}

export class OpenAiProvider implements ChatProvider {
  private readonly client: OpenAiClientLike;
  private readonly model: string;

  constructor(options: OpenAiProviderOptions) {
    this.model = options.model;
    this.client =
      options.client ??
      new OpenAI({
        apiKey: options.apiKey,
        timeout: options.timeoutMs ?? PROVIDER_TIMEOUT_MS,
        maxRetries: options.maxRetries ?? PROVIDER_MAX_RETRIES,
      });
  }

  async complete(
    messages: readonly ProviderMessage[],
    options: CompleteOptions = {},
  ): Promise<string> {
    let completion: Awaited<ReturnType<OpenAiClientLike['chat']['completions']['create']>>;
    try {
      completion = await this.client.chat.completions.create(
        {
          model: this.model,
          messages: messages.map((message) => ({ role: message.role, content: message.content })),
          max_completion_tokens: options.maxTokens ?? DEFAULT_MAX_COMPLETION_TOKENS,
        },
        options.signal !== undefined ? { signal: options.signal } : undefined,
      );
    } catch (error) {
      // Phase 6 (P1-12): never embed the underlying exception message —
      // SDK errors can carry request details and credential-shaped
      // text. The numeric HTTP status is safe and operationally useful.
      const status =
        typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
      throw new AiProviderError(
        typeof status === 'number'
          ? `chat completion failed (HTTP ${status})`
          : 'chat completion failed',
      );
    }
    const content = completion.choices[0]?.message.content;
    if (content === null || content === undefined || content.trim() === '') {
      throw new AiProviderError('chat completion returned an empty reply');
    }
    return content;
  }
}

/**
 * Build the production provider from config, or null when no API key is
 * configured — AI chat then degrades gracefully instead of blocking
 * boot (PLAN §11).
 */
export function createChatProvider(config: AppConfig): ChatProvider | null {
  if (config.openaiApiKey === undefined) return null;
  return new OpenAiProvider({ apiKey: config.openaiApiKey, model: config.openaiModel });
}

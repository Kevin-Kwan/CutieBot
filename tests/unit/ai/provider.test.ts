import { describe, expect, it } from 'vitest';
import {
  AiProviderError,
  OpenAiProvider,
  createChatProvider,
  type OpenAiClientLike,
  type ProviderMessage,
} from '../../../src/features/ai/provider.js';
import { makeCtx } from '../../fixtures/fakes.js';

/** Fake SDK client: records create() params, returns a canned completion. */
class FakeOpenAiClient implements OpenAiClientLike {
  readonly calls: {
    model: string;
    messages: { role: string; content: string }[];
    max_completion_tokens: number;
  }[] = [];
  readonly signals: (AbortSignal | undefined)[] = [];
  response: string | null = 'fake reply';
  error: unknown = undefined;

  readonly chat = {
    completions: {
      create: async (
        params: {
          model: string;
          messages: { role: string; content: string }[];
          max_completion_tokens: number;
        },
        options?: { signal?: AbortSignal },
      ) => {
        this.calls.push(params);
        this.signals.push(options?.signal);
        if (this.error !== undefined) throw this.error;
        return { choices: [{ message: { content: this.response } }] };
      },
    },
  };
}

const MESSAGES: ProviderMessage[] = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: 'hello' },
];

describe('OpenAiProvider', () => {
  it('sends the configured model and the full message list, returns the reply text', async () => {
    const client = new FakeOpenAiClient();
    const provider = new OpenAiProvider({ apiKey: 'sk-test', model: 'model-from-config', client });
    await expect(provider.complete(MESSAGES)).resolves.toBe('fake reply');
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.model).toBe('model-from-config');
    expect(client.calls[0]?.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hello' },
    ]);
  });

  it('wraps SDK failures in AiProviderError', async () => {
    const client = new FakeOpenAiClient();
    client.error = new Error('429 rate limited');
    const provider = new OpenAiProvider({ apiKey: 'sk-test', model: 'm', client });
    await expect(provider.complete(MESSAGES)).rejects.toBeInstanceOf(AiProviderError);
  });

  // Phase 6 (P1-12): the wrapped error must not embed the underlying
  // exception message (SDK errors can carry credential-shaped text);
  // the numeric HTTP status is kept, the message text is not.
  it('keeps the HTTP status but never the underlying error message', async () => {
    const client = new FakeOpenAiClient();
    client.error = Object.assign(new Error('denied for key sk-live-secret-123'), { status: 429 });
    const provider = new OpenAiProvider({ apiKey: 'sk-test', model: 'm', client });
    const failure = await provider.complete(MESSAGES).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AiProviderError);
    expect((failure as Error).message).toContain('429');
    expect((failure as Error).message).not.toContain('sk-live-secret-123');
    expect((failure as Error).message).not.toContain('denied for key');
  });

  // Phase 6 (P1-10): every call carries an output-token cap, and the
  // caller's AbortSignal is forwarded to the SDK.
  it('sends a max completion token cap and forwards the abort signal', async () => {
    const client = new FakeOpenAiClient();
    const provider = new OpenAiProvider({ apiKey: 'sk-test', model: 'm', client });
    const controller = new AbortController();
    await provider.complete(MESSAGES, { signal: controller.signal, maxTokens: 42 });
    expect(client.calls[0]?.max_completion_tokens).toBe(42);
    expect(client.signals[0]).toBe(controller.signal);
    await provider.complete(MESSAGES);
    expect(client.calls[1]?.max_completion_tokens).toBeGreaterThan(0);
  });

  it('treats an empty or null completion as a provider error, never a blank reply', async () => {
    const client = new FakeOpenAiClient();
    const provider = new OpenAiProvider({ apiKey: 'sk-test', model: 'm', client });
    client.response = null;
    await expect(provider.complete(MESSAGES)).rejects.toBeInstanceOf(AiProviderError);
    client.response = '   ';
    await expect(provider.complete(MESSAGES)).rejects.toBeInstanceOf(AiProviderError);
  });

  it('constructs against the real SDK offline (no key use until a call is made)', () => {
    expect(() => new OpenAiProvider({ apiKey: 'sk-test', model: 'm' })).not.toThrow();
  });
});

describe('createChatProvider', () => {
  it('returns null when no API key is configured (feature degrades, boot continues)', () => {
    const ctx = makeCtx();
    expect(ctx.config.openaiApiKey).toBeUndefined();
    expect(createChatProvider(ctx.config)).toBeNull();
  });

  it('builds a provider from config when a key is present, using the configured model', () => {
    const ctx = makeCtx();
    const config = { ...ctx.config, openaiApiKey: 'sk-test', openaiModel: 'cfg-model' };
    expect(createChatProvider(config)).toBeInstanceOf(OpenAiProvider);
  });
});

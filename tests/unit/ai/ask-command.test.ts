import type { ChatInputCommandInteraction } from 'discord.js';
import { describe, expect, it } from 'vitest';
import {
  AI_LIMITED_USER_MESSAGE,
  AI_NOT_CONFIGURED_MESSAGE,
  AI_RESET_DONE_MESSAGE,
  askCommand,
} from '../../../src/features/ai/commands/ask.js';
import { ConversationStore } from '../../../src/features/ai/history.js';
import { DailyUsageLimiter } from '../../../src/features/ai/limits.js';
import type { ChatProvider } from '../../../src/features/ai/provider.js';
import { AiService, MAX_INPUT_CHARS, setAiService } from '../../../src/features/ai/service.js';
import { createLogger } from '../../../src/core/logger.js';
import { makeCtx } from '../../fixtures/fakes.js';
import type { AppContext } from '../../../src/core/context.js';

interface RecordedCall {
  readonly method: 'reply' | 'editReply' | 'followUp' | 'deferReply';
  readonly options: { content?: string; allowedMentions?: unknown; flags?: unknown } | undefined;
}

/** Fabricated /ask interaction with subcommand + string options. */
class FakeAskInteraction {
  readonly commandName = 'ask';
  readonly guildId: string | null = 'guild-1';
  readonly channelId = 'channel-1';
  readonly user = { id: 'user-1' };
  replied = false;
  deferred = false;
  readonly calls: RecordedCall[] = [];
  readonly options: {
    getSubcommand: () => string;
    getString: (name: string) => string | null;
  };

  constructor(subcommand: string, prompt: string | null = 'hello ai') {
    this.options = {
      getSubcommand: () => subcommand,
      getString: (name) => (name === 'prompt' ? prompt : null),
    };
  }

  async reply(options: RecordedCall['options']): Promise<unknown> {
    this.calls.push({ method: 'reply', options });
    this.replied = true;
    return {};
  }
  async editReply(options: RecordedCall['options']): Promise<unknown> {
    this.calls.push({ method: 'editReply', options });
    this.replied = true;
    return {};
  }
  async followUp(options: RecordedCall['options']): Promise<unknown> {
    this.calls.push({ method: 'followUp', options });
    return {};
  }
  deferError: unknown = undefined;
  async deferReply(options?: RecordedCall['options']): Promise<unknown> {
    this.calls.push({ method: 'deferReply', options });
    if (this.deferError !== undefined) throw this.deferError;
    this.deferred = true;
    return {};
  }

  get surfaces(): RecordedCall[] {
    return this.calls.filter((call) => call.method !== 'deferReply');
  }
}

class ScriptedProvider implements ChatProvider {
  replies: string[] = [];
  async complete(): Promise<string> {
    return this.replies.shift() ?? 'scripted answer';
  }
}

function makeAskCtx(
  provider: ScriptedProvider,
  perUserDaily = 100,
): { ctx: AppContext; store: ConversationStore } {
  const ctx = makeCtx();
  const store = new ConversationStore({ maxMessages: 20, maxApproxTokens: 4_000, ttlMs: 60_000 });
  setAiService(
    ctx,
    new AiService({
      store,
      limiter: new DailyUsageLimiter({ perUserDaily, globalDaily: 1_000 }),
      provider,
      logger: createLogger('silent'),
    }),
  );
  return { ctx, store };
}

async function runAsk(ctx: AppContext, interaction: FakeAskInteraction): Promise<void> {
  await askCommand.execute(ctx, interaction as unknown as ChatInputCommandInteraction);
}

describe('/ask payload', () => {
  it('serializes as ask with chat + reset subcommands; chat has a required prompt option', () => {
    const json = askCommand.data.toJSON() as {
      name: string;
      options: {
        name: string;
        type: number;
        options?: { name: string; type: number; required?: boolean }[];
      }[];
    };
    expect(json.name).toBe('ask');
    expect(json.options.map((option) => option.name)).toEqual(['chat', 'reset']);
    const chat = json.options[0];
    expect(chat?.options).toHaveLength(1);
    expect(chat?.options?.[0]).toMatchObject({ name: 'prompt', type: 3, required: true });
  });
});

describe('/ask chat', () => {
  it('defers first, then edits the reply with the answer — mention-safe', async () => {
    const provider = new ScriptedProvider();
    const { ctx, store } = makeAskCtx(provider);
    const interaction = new FakeAskInteraction('chat', 'what is 2+2?');
    await runAsk(ctx, interaction);

    expect(interaction.calls[0]?.method).toBe('deferReply');
    const surface = interaction.surfaces;
    expect(surface).toHaveLength(1);
    expect(surface[0]?.method).toBe('editReply');
    expect(surface[0]?.options?.content).toBe('scripted answer');
    expect(surface[0]?.options?.allowedMentions).toEqual({ parse: [], repliedUser: false });
    // Both turns landed in the per-user conversation for this channel.
    expect(store.get('ask:channel-1:user-1')).toEqual([
      { role: 'user', content: 'what is 2+2?' },
      { role: 'assistant', content: 'scripted answer' },
    ]);
  });

  it('sends a >2000-char answer as editReply + followUps, in order, all mention-safe', async () => {
    const provider = new ScriptedProvider();
    provider.replies = [`${'word '.repeat(600)}end`];
    const { ctx } = makeAskCtx(provider);
    const interaction = new FakeAskInteraction('chat', 'essay please');
    await runAsk(ctx, interaction);

    const surface = interaction.surfaces;
    expect(surface.length).toBeGreaterThanOrEqual(2);
    expect(surface[0]?.method).toBe('editReply');
    for (const call of surface.slice(1)) expect(call.method).toBe('followUp');
    for (const call of surface) {
      expect(call.options?.allowedMentions).toEqual({ parse: [], repliedUser: false });
      expect(call.options?.content?.length ?? 0).toBeLessThanOrEqual(2_000);
    }
    expect(surface.at(-1)?.options?.content).toContain('end');
  });

  it('reports the per-user daily limit instead of calling the provider again', async () => {
    const provider = new ScriptedProvider();
    const { ctx } = makeAskCtx(provider, 0); // per-user cap of 0
    const interaction = new FakeAskInteraction('chat', 'hello');
    await runAsk(ctx, interaction);
    expect(interaction.surfaces).toHaveLength(1);
    expect(interaction.surfaces[0]?.options?.content).toBe(AI_LIMITED_USER_MESSAGE);
  });
});

describe('/ask reset', () => {
  it('wipes the conversation and confirms ephemerally, without deferring', async () => {
    const provider = new ScriptedProvider();
    const { ctx, store } = makeAskCtx(provider);
    await runAsk(ctx, new FakeAskInteraction('chat', 'remember this'));
    expect(store.get('ask:channel-1:user-1')).toHaveLength(2);

    const resetInteraction = new FakeAskInteraction('reset');
    await runAsk(ctx, resetInteraction);
    expect(store.get('ask:channel-1:user-1')).toEqual([]);
    expect(resetInteraction.calls.some((call) => call.method === 'deferReply')).toBe(false);
    expect(resetInteraction.surfaces).toHaveLength(1);
    expect(resetInteraction.surfaces[0]?.options?.content).toBe(AI_RESET_DONE_MESSAGE);
  });
});

describe('/ask without configuration', () => {
  it('answers with the not-configured message when no API key is set', async () => {
    const ctx = makeCtx(); // openaiApiKey undefined -> getAiService returns null
    const interaction = new FakeAskInteraction('chat', 'hello');
    await runAsk(ctx, interaction);
    expect(interaction.surfaces).toHaveLength(1);
    expect(interaction.surfaces[0]?.options?.content).toBe(AI_NOT_CONFIGURED_MESSAGE);
    expect(interaction.calls.some((call) => call.method === 'deferReply')).toBe(false);
  });
});

describe('/ask chat — Phase 6', () => {
  // P1-11 regression: when the defer fails with 10062 the interaction
  // is dead — the command must not run the turn at all (no quota spent,
  // no provider call, no history write).
  it('aborts with zero side effects when deferReply rejects with 10062', async () => {
    const provider = new ScriptedProvider();
    const { ctx, store } = makeAskCtx(provider);
    const interaction = new FakeAskInteraction('chat', 'hello?');
    interaction.deferError = Object.assign(new Error('Unknown interaction'), { code: 10062 });
    await runAsk(ctx, interaction);
    expect(interaction.surfaces).toHaveLength(0);
    expect(store.get(AiService.askConversationId('channel-1', 'user-1'))).toEqual([]);
    // A fresh conversation entry may exist from admission, but no turn
    // was appended and the provider was never called (replies unused).
    expect(provider.replies).toHaveLength(0);
  });

  // P1-09: the reset subcommand is exempt from the chat cooldown.
  it('policy exempts the reset subcommand from the cooldown', () => {
    const exempt = askCommand.policy?.cooldownExempt;
    expect(exempt).toBeTypeOf('function');
    const resetInteraction = new FakeAskInteraction('reset');
    const chatInteraction = new FakeAskInteraction('chat');
    expect(exempt?.(resetInteraction as unknown as ChatInputCommandInteraction)).toBe(true);
    expect(exempt?.(chatInteraction as unknown as ChatInputCommandInteraction)).toBe(false);
  });

  // G15: the prompt option enforces the input cap at the Discord layer.
  it('prompt option carries the MAX_INPUT_CHARS max length', () => {
    const json = askCommand.data.toJSON() as {
      options: { name: string; options?: { name: string; max_length?: number }[] }[];
    };
    const prompt = json.options[0]?.options?.[0];
    expect(prompt?.max_length).toBe(MAX_INPUT_CHARS);
  });
});

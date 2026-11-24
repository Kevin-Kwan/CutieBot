import { MessageType, type Message } from 'discord.js';
import { describe, expect, it } from 'vitest';
import {
  AI_EMPTY_PROMPT_MESSAGE,
  aiTriggerFor,
  extractPrompt,
  handleAiMessage,
  type MessageRoutingInput,
} from '../../../src/features/ai/messages.js';
import type { AiTriggerService, ChatOutcome } from '../../../src/features/ai/service.js';
import {
  AI_LIMITED_USER_MESSAGE,
  AI_ERROR_MESSAGE,
  AI_UNAVAILABLE_MESSAGE,
} from '../../../src/features/ai/commands/ask.js';
import { makeCtx } from '../../fixtures/fakes.js';
import type { AppContext } from '../../../src/core/context.js';

const BOT_ID = 'bot-1';

function routing(overrides: Partial<MessageRoutingInput> = {}): MessageRoutingInput {
  return {
    authorId: 'user-1',
    authorBot: false,
    guildId: 'guild-1',
    mentionedUserIds: [],
    repliedUserId: null,
    kind: 'default',
    content: 'hello there',
    ...overrides,
  };
}

describe('aiTriggerFor — routing matrix', () => {
  it('answers a guild @mention of the bot', () => {
    expect(aiTriggerFor(routing({ mentionedUserIds: [BOT_ID] }), BOT_ID)).toBe('mention');
  });

  it('answers a reply to one of the bot messages', () => {
    expect(aiTriggerFor(routing({ kind: 'reply', repliedUserId: BOT_ID }), BOT_ID)).toBe('reply');
  });

  it('prefers the reply trigger when a reply also pings the bot', () => {
    expect(
      aiTriggerFor(
        routing({ kind: 'reply', repliedUserId: BOT_ID, mentionedUserIds: [BOT_ID] }),
        BOT_ID,
      ),
    ).toBe('reply');
  });

  it('ignores bot authors — including other bots and the bot itself', () => {
    expect(
      aiTriggerFor(routing({ authorBot: true, mentionedUserIds: [BOT_ID] }), BOT_ID),
    ).toBeNull();
    expect(
      aiTriggerFor(routing({ authorBot: true, kind: 'reply', repliedUserId: BOT_ID }), BOT_ID),
    ).toBeNull();
    expect(
      aiTriggerFor(routing({ authorId: BOT_ID, mentionedUserIds: [BOT_ID] }), BOT_ID),
    ).toBeNull();
  });

  it('ignores DMs, for both triggers', () => {
    expect(aiTriggerFor(routing({ guildId: null, mentionedUserIds: [BOT_ID] }), BOT_ID)).toBeNull();
    expect(
      aiTriggerFor(routing({ guildId: null, kind: 'reply', repliedUserId: BOT_ID }), BOT_ID),
    ).toBeNull();
  });

  it('ignores plain messages, mentions of others, and replies to others', () => {
    expect(aiTriggerFor(routing(), BOT_ID)).toBeNull();
    expect(aiTriggerFor(routing({ mentionedUserIds: ['someone-else'] }), BOT_ID)).toBeNull();
    expect(
      aiTriggerFor(routing({ kind: 'reply', repliedUserId: 'someone-else' }), BOT_ID),
    ).toBeNull();
    // The legacy substring trigger ("cutie" anywhere in the text) is
    // gone: content is only ever checked for EMPTINESS (G8), never
    // matched against trigger words.
    expect(aiTriggerFor(routing({ content: 'cutie what is up' }), BOT_ID)).toBeNull();
  });

  // Phase 6 (G8): without the MessageContent intent, a reply with
  // reply-ping OFF arrives with content stripped to ''. That must not
  // trigger a bogus empty-prompt reply.
  it('does not trigger on a reply with empty content and no bot mention (reply-ping off)', () => {
    expect(
      aiTriggerFor(routing({ kind: 'reply', repliedUserId: BOT_ID, content: '' }), BOT_ID),
    ).toBeNull();
    expect(
      aiTriggerFor(routing({ kind: 'reply', repliedUserId: BOT_ID, content: '   ' }), BOT_ID),
    ).toBeNull();
  });

  it('still triggers on a reply with empty content when the bot is actually mentioned (ping on)', () => {
    expect(
      aiTriggerFor(
        routing({ kind: 'reply', repliedUserId: BOT_ID, content: '', mentionedUserIds: [BOT_ID] }),
        BOT_ID,
      ),
    ).toBe('reply');
  });

  it('ignores system posts even when they name the bot', () => {
    expect(aiTriggerFor(routing({ kind: 'other', mentionedUserIds: [BOT_ID] }), BOT_ID)).toBeNull();
  });
});

describe('extractPrompt', () => {
  it('strips both mention forms and trims', () => {
    expect(extractPrompt(`<@${BOT_ID}> what is up?`, BOT_ID)).toBe('what is up?');
    expect(extractPrompt(`hey <@!${BOT_ID}> tell me a joke`, BOT_ID)).toBe('hey   tell me a joke');
    expect(extractPrompt(`<@${BOT_ID}>`, BOT_ID)).toBe('');
    expect(extractPrompt('no mention here', BOT_ID)).toBe('no mention here');
  });
});

/* ------------------------------------------------------------------ */
/* Handler behaviour against a fake message + stub service             */
/* ------------------------------------------------------------------ */

interface SentMessage {
  readonly via: 'reply' | 'channel';
  readonly options: { content?: string; allowedMentions?: unknown };
}

class FakeChannel {
  readonly sent: SentMessage[] = [];
  typingCount = 0;
  async sendTyping(): Promise<void> {
    this.typingCount += 1;
  }
  async send(options: SentMessage['options']): Promise<unknown> {
    this.sent.push({ via: 'channel', options });
    return {};
  }
}

class FakeMessage {
  author = { id: 'user-1', bot: false };
  guildId: string | null = 'guild-1';
  channelId = 'channel-1';
  member: { permissions: { has: (flag: bigint) => boolean } } | null = null;
  content = `<@${BOT_ID}> hello there`;
  type: MessageType = MessageType.Default;
  mentions: { users: Map<string, unknown>; repliedUser: { id: string } | null } = {
    users: new Map([[BOT_ID, {}]]),
    repliedUser: null,
  };
  readonly channel = new FakeChannel();
  readonly replies: SentMessage[] = [];

  async reply(options: SentMessage['options']): Promise<unknown> {
    this.replies.push({ via: 'reply', options });
    return {};
  }
}

class StubService implements AiTriggerService {
  readonly chats: { conversationId: string; userId: string; prompt: string }[] = [];
  readonly resets: string[] = [];
  outcome: ChatOutcome = { kind: 'reply', text: 'stub answer' };
  async chat(input: {
    conversationId: string;
    userId: string;
    prompt: string;
  }): Promise<ChatOutcome> {
    this.chats.push(input);
    return this.outcome;
  }
  reset(conversationId: string): void {
    this.resets.push(conversationId);
  }
}

function makeHandlerCtx(): AppContext {
  const ctx = makeCtx();
  return { ...ctx, client: { user: { id: BOT_ID } } as unknown as AppContext['client'] };
}

async function runHandler(
  message: FakeMessage,
  service: StubService,
  ctx: AppContext = makeHandlerCtx(),
): Promise<void> {
  await handleAiMessage(ctx, service, message as unknown as Message);
}

describe('handleAiMessage', () => {
  it('answers a mention: chat runs on the channel conversation, reply is mention-safe', async () => {
    const message = new FakeMessage();
    const service = new StubService();
    await runHandler(message, service);
    expect(service.chats).toEqual([
      { conversationId: 'chat:channel-1', userId: 'user-1', prompt: 'hello there' },
    ]);
    expect(message.replies).toHaveLength(1);
    expect(message.replies[0]?.options.content).toBe('stub answer');
    expect(message.replies[0]?.options.allowedMentions).toEqual({ parse: [], repliedUser: false });
  });

  it('does nothing for bot authors, DMs, and untriggered messages', async () => {
    const service = new StubService();

    const botMessage = new FakeMessage();
    botMessage.author = { id: 'other-bot', bot: true };
    await runHandler(botMessage, service);

    const dm = new FakeMessage();
    dm.guildId = null;
    await runHandler(dm, service);

    const plain = new FakeMessage();
    plain.mentions = { users: new Map(), repliedUser: null };
    plain.content = 'cutie what is up'; // legacy substring bait — must NOT trigger
    await runHandler(plain, service);

    expect(service.chats).toEqual([]);
    expect(botMessage.replies).toEqual([]);
    expect(dm.replies).toEqual([]);
    expect(plain.replies).toEqual([]);
  });

  it('answers a reply to the bot even without a mention ping', async () => {
    const message = new FakeMessage();
    message.type = MessageType.Reply;
    message.mentions = { users: new Map(), repliedUser: null };
    message.mentions.repliedUser = { id: BOT_ID };
    message.content = 'and why is that?';
    const service = new StubService();
    await runHandler(message, service);
    expect(service.chats).toEqual([
      { conversationId: 'chat:channel-1', userId: 'user-1', prompt: 'and why is that?' },
    ]);
  });

  it('a bare mention gets the greeting, without touching the provider or the caps', async () => {
    const message = new FakeMessage();
    message.content = `<@${BOT_ID}>`;
    const service = new StubService();
    await runHandler(message, service);
    expect(service.chats).toEqual([]);
    expect(message.replies[0]?.options.content).toBe(AI_EMPTY_PROMPT_MESSAGE);
    expect(message.replies[0]?.options.allowedMentions).toEqual({ parse: [], repliedUser: false });
  });

  it('throttles repeat mentions from the same user silently', async () => {
    const ctx = makeHandlerCtx();
    const service = new StubService();
    await runHandler(new FakeMessage(), service, ctx);
    const second = new FakeMessage();
    await runHandler(second, service, ctx);
    expect(service.chats).toHaveLength(1);
    expect(second.replies).toEqual([]);
  });

  it('surfaces limited and error outcomes as short replies; reset stays silent', async () => {
    const ctx = makeHandlerCtx();

    const limitedService = new StubService();
    limitedService.outcome = { kind: 'limited', scope: 'user' };
    const limitedMessage = new FakeMessage();
    await runHandler(limitedMessage, limitedService, ctx);
    expect(limitedMessage.replies[0]?.options.content).toBe(AI_LIMITED_USER_MESSAGE);

    const errorService = new StubService();
    errorService.outcome = { kind: 'error' };
    const errorMessage = new FakeMessage();
    errorMessage.author = { id: 'user-2', bot: false }; // fresh user: not throttled
    await runHandler(errorMessage, errorService, ctx);
    expect(errorMessage.replies[0]?.options.content).toBe(AI_ERROR_MESSAGE);

    const resetService = new StubService();
    resetService.outcome = { kind: 'reset' };
    const resetMessage = new FakeMessage();
    resetMessage.author = { id: 'user-3', bot: false };
    await runHandler(resetMessage, resetService, ctx);
    expect(resetMessage.replies).toEqual([]);
    expect(resetMessage.channel.sent).toEqual([]);
  });
});

describe('handleAiMessage — Phase 6', () => {
  it('G8: a reply to the bot with stripped (empty) content does not call the service', async () => {
    const ctx = makeHandlerCtx();
    const service = new StubService();
    const message = new FakeMessage();
    message.type = MessageType.Reply;
    message.mentions = { users: new Map(), repliedUser: { id: BOT_ID } };
    message.content = ''; // no MessageContent intent + reply-ping off
    await handleAiMessage(ctx, service, message as unknown as Message);
    expect(service.chats).toHaveLength(0);
    expect(message.replies).toHaveLength(0);
  });

  it('G12: a ManageMessages member can reset the channel conversation by mentioning "reset"', async () => {
    const ctx = makeHandlerCtx();
    const service = new StubService();
    const message = new FakeMessage();
    message.content = `<@${BOT_ID}> reset`;
    message.member = { permissions: { has: () => true } };
    await handleAiMessage(ctx, service, message as unknown as Message);
    expect(service.resets).toEqual(['chat:channel-1']);
    expect(service.chats).toHaveLength(0);
    expect(message.replies[0]?.options.content).toContain('reset');
  });

  it('G12: "reset" from a member WITHOUT ManageMessages is just a chat prompt', async () => {
    const ctx = makeHandlerCtx();
    const service = new StubService();
    const message = new FakeMessage();
    message.content = `<@${BOT_ID}> reset`;
    message.member = { permissions: { has: () => false } };
    await handleAiMessage(ctx, service, message as unknown as Message);
    expect(service.resets).toHaveLength(0);
    expect(service.chats).toHaveLength(1);
  });

  it('P2-09: an unavailable outcome is reported to the user, not thrown', async () => {
    const ctx = makeHandlerCtx();
    const service = new StubService();
    service.outcome = { kind: 'unavailable' };
    const message = new FakeMessage();
    await handleAiMessage(ctx, service, message as unknown as Message);
    expect(message.replies[0]?.options.content).toBe(AI_UNAVAILABLE_MESSAGE);
  });
});

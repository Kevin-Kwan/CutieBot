import { Events, MessageType, PermissionFlagsBits, type Message } from 'discord.js';
import type { AppContext } from '../../core/context.js';
import { serializeError } from '../../core/errors.js';
import {
  AI_BUSY_MESSAGE,
  AI_ERROR_MESSAGE,
  AI_LIMITED_GLOBAL_MESSAGE,
  AI_LIMITED_USER_MESSAGE,
  AI_UNAVAILABLE_MESSAGE,
} from './commands/ask.js';
import { NO_MENTIONS, deliverChunks } from './deliver.js';
import { AiService, getAiService, type AiTriggerService } from './service.js';

/**
 * Mention/reply message triggers (PLAN §8).
 *
 * The bot answers a guild message only when it is @mentioned or when
 * the message replies to one of the bot's own messages. That is the
 * whole trigger set: the legacy substring trigger (any message
 * containing "cutie", including inside unrelated words) is cut, bot
 * authors are always ignored (no bot-to-bot loops), and DMs are out
 * of scope. None of this needs the privileged MessageContent intent —
 * mention and reply metadata arrive with the message event.
 *
 * The routing decision is a pure function over a plain input shape so
 * the full matrix is unit-tested without Discord objects.
 */

export type AiTrigger = 'mention' | 'reply';

export interface MessageRoutingInput {
  readonly authorId: string;
  readonly authorBot: boolean;
  /** Null in DMs. */
  readonly guildId: string | null;
  readonly mentionedUserIds: readonly string[];
  /** Author of the message this one replies to, when it is a reply. */
  readonly repliedUserId: string | null;
  /** 'default' and 'reply' are user messages; anything else is a system post. */
  readonly kind: 'default' | 'reply' | 'other';
  /**
   * Message content. Used ONLY for an emptiness check on the reply
   * trigger (G8) — never for substring matching; the legacy "cutie"
   * substring trigger stays gone.
   */
  readonly content: string;
}

/** Decide whether (and why) the bot should answer this message. */
export function aiTriggerFor(input: MessageRoutingInput, botUserId: string): AiTrigger | null {
  if (input.authorBot || input.authorId === botUserId) return null;
  if (input.guildId === null) return null;
  if (input.kind === 'other') return null;
  if (input.repliedUserId === botUserId) {
    // Phase 6 (G8): without the privileged MessageContent intent, a
    // reply whose author had reply-ping OFF arrives with its content
    // stripped to ''. Triggering on it would send the model an empty
    // prompt and produce a bogus out-of-context reply. A reply counts
    // only when it carries actual content or an actual bot mention
    // (ping ON populates the mentions). Note the operational
    // consequence: with reply-ping off AND no content intent, replies
    // to the bot simply cannot be detected — documented in README.
    const hasContent = input.content.trim().length > 0;
    if (hasContent || input.mentionedUserIds.includes(botUserId)) return 'reply';
    return null;
  }
  if (input.mentionedUserIds.includes(botUserId)) return 'mention';
  return null;
}

/** Strip the bot's own mention tokens from a prompt, then trim. */
export function extractPrompt(content: string, botUserId: string): string {
  return content.replaceAll(`<@${botUserId}>`, ' ').replaceAll(`<@!${botUserId}>`, ' ').trim();
}

/** Anti-spam throttle for message triggers (the /ask path uses its policy). */
export const AI_MESSAGE_COOLDOWN_MS = 10_000;

export const AI_EMPTY_PROMPT_MESSAGE =
  "Hi! Mention me with a question and I'll do my best to answer.";

export const AI_CHANNEL_RESET_MESSAGE = 'Channel conversation reset — fresh start.';

/**
 * The moderator kill switch for the shared channel conversation
 * (Phase 6, G12 + orchestrator ruling 3): a member with ManageMessages
 * who @mentions the bot with exactly "reset" wipes the channel
 * conversation. Checked before the trigger/cooldown logic — a reset
 * is a moderation action, not a chat turn, and must work even while
 * the conversation is being spammed.
 */
export function isChannelResetRequest(
  input: MessageRoutingInput,
  botUserId: string,
  canManageMessages: boolean,
): boolean {
  if (!canManageMessages) return false;
  if (input.authorBot || input.authorId === botUserId) return false;
  if (input.guildId === null) return false;
  if (!input.mentionedUserIds.includes(botUserId)) return false;
  return extractPrompt(input.content, botUserId).trim().toLowerCase() === 'reset';
}

function routingInputOf(message: Message): MessageRoutingInput {
  return {
    authorId: message.author.id,
    authorBot: message.author.bot,
    guildId: message.guildId,
    mentionedUserIds: [...message.mentions.users.keys()],
    repliedUserId: message.mentions.repliedUser?.id ?? null,
    kind:
      message.type === MessageType.Default
        ? 'default'
        : message.type === MessageType.Reply
          ? 'reply'
          : 'other',
    content: message.content,
  };
}

/**
 * Handle one message-create event. Exported for tests; production
 * uses attachAiMessageHandler. Never throws — failures are logged,
 * because an unhandled rejection in a message listener is exactly
 * how the legacy bot lost errors (AUDIT §2.4).
 */
export async function handleAiMessage(
  ctx: AppContext,
  service: AiTriggerService,
  message: Message,
): Promise<void> {
  const botUserId = ctx.client.user?.id;
  if (botUserId === undefined) return;
  const input = routingInputOf(message);

  // Moderator channel reset (G12) — before triggers and cooldowns.
  const canManageMessages =
    message.member?.permissions.has(PermissionFlagsBits.ManageMessages) ?? false;
  if (isChannelResetRequest(input, botUserId, canManageMessages)) {
    service.reset(AiService.channelConversationId(message.channelId));
    await message.reply({ content: AI_CHANNEL_RESET_MESSAGE, allowedMentions: NO_MENTIONS });
    return;
  }

  if (aiTriggerFor(input, botUserId) === null) return;

  const cooldownKey = `ai:message:${message.author.id}`;
  if (ctx.cooldowns.hit(cooldownKey, AI_MESSAGE_COOLDOWN_MS) > 0) {
    return; // throttled: stay silent rather than spamming a warning
  }

  const prompt = extractPrompt(message.content, botUserId);
  if (prompt === '') {
    await message.reply({ content: AI_EMPTY_PROMPT_MESSAGE, allowedMentions: NO_MENTIONS });
    return;
  }

  const channel = message.channel;
  if ('sendTyping' in channel) {
    await channel.sendTyping().catch(() => undefined);
  }

  const outcome = await service.chat({
    conversationId: AiService.channelConversationId(message.channelId),
    userId: message.author.id,
    prompt,
  });

  switch (outcome.kind) {
    case 'reply':
      await deliverChunks(outcome.text, async (options, index) => {
        if (index === 0) {
          await message.reply(options);
        } else if ('send' in channel) {
          await channel.send(options);
        }
      });
      return;
    case 'limited':
      await message.reply({
        content: outcome.scope === 'global' ? AI_LIMITED_GLOBAL_MESSAGE : AI_LIMITED_USER_MESSAGE,
        allowedMentions: NO_MENTIONS,
      });
      return;
    case 'error':
      await message.reply({ content: AI_ERROR_MESSAGE, allowedMentions: NO_MENTIONS });
      return;
    case 'unavailable':
      await message.reply({ content: AI_UNAVAILABLE_MESSAGE, allowedMentions: NO_MENTIONS });
      return;
    case 'busy':
      await message.reply({ content: AI_BUSY_MESSAGE, allowedMentions: NO_MENTIONS });
      return;
    case 'reset':
      // The channel conversation was reset mid-flight; the reply was
      // discarded on purpose — saying so here would just be noise.
      return;
  }
}

/**
 * Attach the mention/reply handler next to the interaction router.
 * When AI is not configured this logs once and attaches nothing.
 * MessageCreate is independent of InteractionCreate, so the handler
 * cannot interfere with command interactions.
 */
export function attachAiMessageHandler(ctx: AppContext): void {
  const service = getAiService(ctx);
  if (service === null) {
    ctx.logger.info('AI chat disabled: no OpenAI API key configured');
    return;
  }
  ctx.client.on(Events.MessageCreate, (message) => {
    void handleAiMessage(ctx, service, message).catch((error: unknown) => {
      ctx.logger.error({ err: serializeError(error) }, 'AI message handler failed');
    });
  });
  ctx.logger.info('AI message handler attached (mention + reply triggers)');
}

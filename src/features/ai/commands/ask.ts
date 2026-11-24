import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { deferIfNeeded, safeEphemeralReply } from '../../../core/responses.js';
import { deliverChunks } from '../deliver.js';
import { AiService, getAiService, MAX_INPUT_CHARS } from '../service.js';

/**
 * /ask — the AI chat slash command (PLAN §8).
 *
 *   /ask chat <prompt>   ask in your per-user conversation for this channel
 *   /ask reset           wipe that conversation (also invalidates any
 *                        reply still being generated — see service.ts)
 *
 * The legacy bot's only AI surface was a substring message trigger;
 * /ask is the explicit, discoverable one. The command defers before
 * the provider call (PLAN §5: slow commands defer first), then edits
 * the deferred reply with the first chunk and follows up with the
 * rest — every chunk mention-neutralized by deliverChunks.
 */

export const ASK_COOLDOWN_MS = 5_000;

export const AI_NOT_CONFIGURED_MESSAGE =
  'AI chat is not configured on this bot (no OpenAI API key is set).';
export const AI_LIMITED_USER_MESSAGE =
  "You've reached your daily AI chat limit. Try again tomorrow.";
export const AI_LIMITED_GLOBAL_MESSAGE =
  'The bot has reached its daily AI chat limit. Try again tomorrow.';
export const AI_ERROR_MESSAGE = 'The AI could not answer just now — please try again in a bit.';
export const AI_UNAVAILABLE_MESSAGE =
  'AI chat is temporarily unavailable — please try again in a bit.';
export const AI_BUSY_MESSAGE = "I'm still working on earlier requests — give me a moment.";
export const AI_RESET_DURING_MESSAGE =
  'That conversation was reset while I was thinking, so I dropped the reply.';
export const AI_RESET_DONE_MESSAGE = 'Conversation reset — fresh start.';

export const askCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Chat with the CutieBot AI')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) =>
      sub
        .setName('chat')
        .setDescription('Ask the AI something')
        .addStringOption((option) =>
          option
            .setName('prompt')
            .setDescription('What do you want to ask?')
            // Phase 6 (G15): enforce the service's input cap at the
            // Discord layer too, instead of silently truncating.
            .setMaxLength(MAX_INPUT_CHARS)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('reset').setDescription('Reset your AI conversation in this channel'),
    ),
  policy: {
    guildOnly: true,
    cooldownMs: ASK_COOLDOWN_MS,
    // Phase 6 (P1-09): reset must not share chat's cooldown — a user
    // who just chatted still needs to be able to reset.
    cooldownExempt: (interaction) => interaction.options.getSubcommand(false) === 'reset',
  },

  async execute(ctx, interaction) {
    const service = getAiService(ctx);
    if (service === null) {
      await safeEphemeralReply(interaction, AI_NOT_CONFIGURED_MESSAGE);
      return;
    }

    const conversationId = AiService.askConversationId(interaction.channelId, interaction.user.id);

    if (interaction.options.getSubcommand() === 'reset') {
      service.reset(conversationId);
      await safeEphemeralReply(interaction, AI_RESET_DONE_MESSAGE);
      return;
    }

    const prompt = interaction.options.getString('prompt', true);
    // P1-11: an expired interaction means the user is gone — running
    // the turn anyway would spend quota on a reply nobody can see.
    const ack = await deferIfNeeded(interaction);
    if (ack === 'expired') return;
    const outcome = await service.chat({ conversationId, userId: interaction.user.id, prompt });

    switch (outcome.kind) {
      case 'reply':
        await deliverChunks(outcome.text, async (options, index) => {
          if (index === 0) {
            await interaction.editReply(options);
          } else {
            await interaction.followUp(options);
          }
        });
        return;
      case 'limited':
        await interaction.editReply({
          content: outcome.scope === 'global' ? AI_LIMITED_GLOBAL_MESSAGE : AI_LIMITED_USER_MESSAGE,
        });
        return;
      case 'reset':
        await interaction.editReply({ content: AI_RESET_DURING_MESSAGE });
        return;
      case 'unavailable':
        await interaction.editReply({ content: AI_UNAVAILABLE_MESSAGE });
        return;
      case 'busy':
        await interaction.editReply({ content: AI_BUSY_MESSAGE });
        return;
      case 'error':
        await interaction.editReply({ content: AI_ERROR_MESSAGE });
        return;
    }
  },
};

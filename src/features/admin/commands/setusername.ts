import { MessageFlags, SlashCommandBuilder, InteractionContextType } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { successEmbed } from '../../../shared/embeds.js';

/**
 * /setusername — owner-only. The legacy file exported only an info block
 * (no run function at all, AUDIT §5.5); this is the first working version.
 * Discord rate-limits username changes, so failures surface via the router.
 */
export const setusernameCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('setusername')
    .setDescription("Set the bot's username (owner only)")
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option
        .setName('name')
        .setDescription('The new username (2–32 characters)')
        .setMinLength(2)
        .setMaxLength(32)
        .setRequired(true),
    ),
  policy: { ownerOnly: true },

  async execute(ctx, interaction) {
    const name = interaction.options.getString('name', true);
    const botUser = ctx.client.user;
    if (botUser === null) {
      await interaction.reply({
        content: 'The bot is not logged in yet.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Phase 6 (P2-10): ack before the (rate-limited, slow) API call.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await botUser.setUsername(name);
    ctx.logger.info(
      { action: 'setusername', actorId: interaction.user.id, name },
      'Bot username changed',
    );
    await interaction.editReply({
      embeds: [successEmbed('Username Updated', `The bot username is now **${name}**.`)],
    });
  },
};

import { MessageFlags, SlashCommandBuilder, InteractionContextType } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { successEmbed } from '../../../shared/embeds.js';

/**
 * /restart — owner-only. The legacy restart called client.destroy() then
 * client.login() on the same client, which cannot work in discord.js v14
 * (destroy is terminal, AUDIT §5.12). v3 instead confirms, logs a clear
 * line, and sends itself SIGTERM: src/index.ts's signal handler runs the
 * real graceful shutdown (player → client → MongoDB) and exits, and the
 * host process manager (Fly) starts the bot again.
 */
export const restartCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('restart')
    .setDescription('Restart the bot (owner only)')
    .setContexts(InteractionContextType.Guild),
  policy: { ownerOnly: true },

  async execute(ctx, interaction) {
    await interaction.reply({
      embeds: [
        successEmbed(
          'Restarting',
          'CutieBot is shutting down now. The host will start it again automatically.',
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    ctx.logger.warn(
      { action: 'restart', actorId: interaction.user.id },
      'Restart requested by owner — shutting down for host restart',
    );
    process.kill(process.pid, 'SIGTERM');
  },
};

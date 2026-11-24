import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { queuePageEmbed, trackDisplayOf } from '../embeds.js';
import { MusicError } from '../guards.js';
import { runMusicCommand } from './shared.js';

/** /queue — the current track plus a page of upcoming tracks. */
export const queueCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('get the songs in the queue')
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((option) =>
      option.setName('page').setDescription('queue page to show').setMinValue(1).setRequired(false),
    ),
  policy: { guildOnly: true },

  async execute(ctx, interaction) {
    await runMusicCommand(ctx, interaction, 'exists', async ({ queue }) => {
      if (queue === null) throw new MusicError('No music is currently playing.');
      const upcoming = queue.tracks.toArray();
      if (queue.currentTrack === null && upcoming.length === 0) {
        throw new MusicError('There is nothing in the queue right now.');
      }
      const embed = queuePageEmbed({
        guildName: interaction.guild?.name ?? 'this server',
        current: queue.currentTrack !== null ? trackDisplayOf(queue.currentTrack) : null,
        upcoming: upcoming.map(trackDisplayOf),
        requestedPage: interaction.options.getInteger('page') ?? 1,
        repeatMode: queue.repeatMode,
      });
      await interaction.editReply({ embeds: [embed] });
    });
  },
};

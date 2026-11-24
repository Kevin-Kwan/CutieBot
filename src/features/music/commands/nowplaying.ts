import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { controllerRow, volumeRow } from '../components/controller.js';
import { nowPlayingEmbed, trackDisplayOf } from '../embeds.js';
import { MusicError } from '../guards.js';
import { runMusicCommand } from './shared.js';

/** /nowplaying — progress embed with the controller buttons attached. */
export const nowplayingCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('view what is playing!')
    .setContexts(InteractionContextType.Guild),
  policy: { guildOnly: true },

  async execute(ctx, interaction) {
    await runMusicCommand(ctx, interaction, 'active', async ({ queue }) => {
      if (queue === null || queue.currentTrack === null) {
        throw new MusicError('No music is currently playing.');
      }
      const embed = nowPlayingEmbed({
        track: trackDisplayOf(queue.currentTrack),
        voiceChannelName: queue.channel?.name ?? null,
        progressBar: queue.node.createProgressBar(),
        volume: queue.node.volume,
        repeatMode: queue.repeatMode,
        paused: queue.node.isPaused(),
      });
      await interaction.editReply({
        embeds: [embed],
        components: [controllerRow(queue.metadata.sessionId), volumeRow(queue.metadata.sessionId)],
      });
    });
  },
};

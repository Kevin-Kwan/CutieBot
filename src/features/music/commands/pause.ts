import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { MusicError } from '../guards.js';
import { confirm, runMusicCommand } from './shared.js';

/** /pause — pause playback. */
export const pauseCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('pause')
    .setDescription('pause the current track')
    .setContexts(InteractionContextType.Guild),
  policy: { guildOnly: true },

  async execute(ctx, interaction) {
    await runMusicCommand(ctx, interaction, 'active', async ({ queue }) => {
      if (queue === null) throw new MusicError('No music is currently playing.');
      if (queue.node.isPaused()) throw new MusicError('The music is already paused.');
      const title = queue.currentTrack?.title ?? 'the current track';
      if (!queue.node.pause()) throw new MusicError('Something went wrong while pausing.');
      await confirm(interaction, `Current music **${title}** paused ✅`);
    });
  },
};

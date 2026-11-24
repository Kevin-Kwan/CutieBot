import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { MusicError } from '../guards.js';
import { confirm, runMusicCommand } from './shared.js';

/** /resume — resume paused playback. */
export const resumeCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('resume')
    .setDescription('resume the current track')
    .setContexts(InteractionContextType.Guild),
  policy: { guildOnly: true },

  async execute(ctx, interaction) {
    await runMusicCommand(ctx, interaction, 'active', async ({ queue }) => {
      if (queue === null) throw new MusicError('No music is currently playing.');
      if (!queue.node.isPaused()) throw new MusicError('The music is not paused.');
      const title = queue.currentTrack?.title ?? 'the current track';
      if (!queue.node.resume()) throw new MusicError('Something went wrong while resuming.');
      await confirm(interaction, `Current music **${title}** resumed ✅`);
    });
  },
};

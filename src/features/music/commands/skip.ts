import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { MusicError } from '../guards.js';
import { confirm, runMusicCommand } from './shared.js';

/** /skip — skip the current track. */
export const skipCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('skip the current track')
    .setContexts(InteractionContextType.Guild),
  policy: { guildOnly: true },

  async execute(ctx, interaction) {
    await runMusicCommand(ctx, interaction, 'active', async ({ queue }) => {
      if (queue === null) throw new MusicError('No music is currently playing.');
      const title = queue.currentTrack?.title ?? 'the current track';
      if (!queue.node.skip()) throw new MusicError('Something went wrong while skipping.');
      await confirm(interaction, `Current music **${title}** skipped ✅`);
    });
  },
};

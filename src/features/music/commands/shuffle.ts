import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { MusicError } from '../guards.js';
import { confirm, runMusicCommand } from './shared.js';

/** /shuffle — shuffle the upcoming tracks in place (legacy semantics). */
export const shuffleCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('shuffle')
    .setDescription('shuffle the queue')
    .setContexts(InteractionContextType.Guild),
  policy: { guildOnly: true },

  async execute(ctx, interaction) {
    await runMusicCommand(ctx, interaction, 'active', async ({ queue }) => {
      if (queue === null) throw new MusicError('No music is currently playing.');
      if (queue.tracks.size === 0) {
        throw new MusicError('No music in the queue after the current one — try again? ❌');
      }
      queue.tracks.shuffle();
      await confirm(interaction, `Queue shuffled — **${queue.tracks.size}** song(s)! ✅`);
    });
  },
};

import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { MusicError } from '../guards.js';
import { confirm, runMusicCommand } from './shared.js';

/** /back — replay the previous track from history. */
export const backCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('back')
    .setDescription('go back to the song before')
    .setContexts(InteractionContextType.Guild),
  policy: { guildOnly: true },

  async execute(ctx, interaction) {
    await runMusicCommand(ctx, interaction, 'active', async ({ queue }) => {
      if (queue === null) throw new MusicError('No music is currently playing.');
      if (queue.history.previousTrack === null) {
        throw new MusicError('There was no music played before — try again? ❌');
      }
      await queue.history.back();
      await confirm(interaction, 'Playing the **previous** track ✅');
    });
  },
};

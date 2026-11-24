import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { MusicError } from '../guards.js';
import { moveVerdict } from '../logic.js';
import { confirm, runMusicCommand } from './shared.js';

/** /move — move a queued track from one 1-based position to another. */
export const moveCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('move')
    .setDescription('move a song to a different position in the queue')
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((option) =>
      option
        .setName('from')
        .setDescription('the current place in the queue of the song')
        .setMinValue(1)
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName('to')
        .setDescription('the place in the queue to move the song to')
        .setMinValue(1)
        .setRequired(true),
    ),
  policy: { guildOnly: true },

  async execute(ctx, interaction) {
    await runMusicCommand(ctx, interaction, 'exists', async ({ queue }) => {
      if (queue === null) throw new MusicError('No music is currently playing.');
      const from = interaction.options.getInteger('from', true);
      const to = interaction.options.getInteger('to', true);
      const verdict = moveVerdict(queue.tracks.size, from, to);
      if (!verdict.ok) throw new MusicError(verdict.error);
      const track = queue.tracks.at(verdict.value.fromIndex);
      if (track === undefined) throw new MusicError('That track does not seem to exist.');
      queue.moveTrack(track, verdict.value.toIndex);
      await confirm(interaction, `Moved **${track.title}** to position **${to}** in the queue ✅`);
    });
  },
};

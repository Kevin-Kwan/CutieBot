import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { MusicError } from '../guards.js';
import { resolveTrackPosition } from '../logic.js';
import { confirm, runMusicCommand } from './shared.js';

/** /remove — remove a queued track by number or exact title/URL. */
export const removeCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('remove')
    .setDescription('remove a song from the queue')
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((option) =>
      option
        .setName('number')
        .setDescription('the place in the queue the song is in')
        .setMinValue(1)
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName('song')
        .setDescription('the name/url of the track you want to remove')
        .setRequired(false),
    ),
  policy: { guildOnly: true },

  async execute(ctx, interaction) {
    await runMusicCommand(ctx, interaction, 'exists', async ({ queue }) => {
      if (queue === null) throw new MusicError('No music is currently playing.');
      const tracks = queue.tracks.toArray();
      if (tracks.length === 0) throw new MusicError('There are no tracks in the queue to remove.');
      const resolved = resolveTrackPosition(tracks, {
        number: interaction.options.getInteger('number'),
        song: interaction.options.getString('song'),
      });
      if (!resolved.ok) throw new MusicError(resolved.error);
      const track = tracks[resolved.value];
      if (track === undefined) throw new MusicError('That track does not seem to exist.');
      const removed = queue.removeTrack(track);
      if (removed === null) throw new MusicError('Something went wrong while removing that track.');
      await confirm(interaction, `Removed **${track.title}** from the queue ✅`);
    });
  },
};

import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { MusicError } from '../guards.js';
import { resolveTrackPosition } from '../logic.js';
import { confirm, runMusicCommand } from './shared.js';

/**
 * /jump — skip ahead to a queued track by number or exact title/URL.
 * Legacy semantics: this is a skip-to (tracks in between are dropped),
 * which is discord-player's node.skipTo.
 */
export const jumpCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('jump')
    .setDescription('jump to a particular track in the queue')
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
        .setDescription('the name/url of the track you want to jump to')
        .setRequired(false),
    ),
  policy: { guildOnly: true },

  async execute(ctx, interaction) {
    await runMusicCommand(ctx, interaction, 'active', async ({ queue }) => {
      if (queue === null) throw new MusicError('No music is currently playing.');
      const tracks = queue.tracks.toArray();
      if (tracks.length === 0) throw new MusicError('There are no tracks in the queue to jump to.');
      const resolved = resolveTrackPosition(tracks, {
        number: interaction.options.getInteger('number'),
        song: interaction.options.getString('song'),
      });
      if (!resolved.ok) throw new MusicError(resolved.error);
      const track = tracks[resolved.value];
      if (track === undefined) throw new MusicError('That track does not seem to exist.');
      if (!queue.node.skipTo(track)) throw new MusicError('Something went wrong while jumping.');
      await confirm(interaction, `Jumped to **${track.title}** ✅`);
    });
  },
};

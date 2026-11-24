import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { MusicError } from '../guards.js';
import { checkAccessFresh } from '../helpers.js';
import { describePlayerError } from '../logic.js';
import { withGuildQueueLock, MAX_QUEUE_SIZE } from '../queue.js';
import { confirm, runMusicCommand, searchTracks } from './shared.js';

/**
 * /playnext — insert a track at the front of the queue (legacy parity).
 *
 * Phase 6c (R5): the Phase 6 code searched and then inserted against
 * the STALE pre-search session — no queue lock, no voice recheck — so
 * leaving voice (or the queue being replaced) during the search still
 * landed the insert. Now the insert runs inside the per-guild lock
 * against a freshly resolved queue and freshly fetched voice state.
 */
export const playnextCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('playnext')
    .setDescription('play a song next!')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option.setName('song').setDescription('the song you want to play next').setRequired(true),
    ),
  policy: { guildOnly: true },

  async execute(ctx, interaction) {
    await runMusicCommand(ctx, interaction, 'active', async () => {
      if (interaction.guildId === null) throw new MusicError('No music is currently playing.');
      const guildId = interaction.guildId;
      const query = interaction.options.getString('song', true);
      const result = await searchTracks(ctx, interaction, query);
      if (result.hasPlaylist()) {
        throw new MusicError("This command doesn't support playlists — try again? ❌");
      }
      const track = result.tracks[0];
      if (track === undefined)
        throw new MusicError(`No results found for "${query}" — try again? ❌`);

      await withGuildQueueLock(guildId, async () => {
        const access = await checkAccessFresh(ctx, interaction, 'active');
        if (!access.ok) throw new MusicError(access.error);
        const queue = access.session.queue;
        if (queue === null) throw new MusicError('No music is currently playing.');
        // Phase 6 (P2-12): insertTrack also enforces the queue cap.
        if (queue.tracks.size >= MAX_QUEUE_SIZE) {
          throw new MusicError(`The queue is full (max ${MAX_QUEUE_SIZE} tracks).`);
        }
        try {
          queue.insertTrack(track, 0);
        } catch (error) {
          throw new MusicError(
            describePlayerError(error instanceof Error ? error : new Error(String(error))),
          );
        }
        await confirm(interaction, 'Track has been inserted into the queue… it will play next 🎧');
      });
    });
  },
};

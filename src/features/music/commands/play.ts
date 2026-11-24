import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { trackDisplayOf } from '../embeds.js';
import { MusicError, NOT_IN_VOICE_MESSAGE } from '../guards.js';
import { checkAccessFresh } from '../helpers.js';
import { describePlayerError } from '../logic.js';
import {
  connectQueue,
  ensureQueue,
  textChannelOf,
  withGuildQueueLock,
  MAX_QUEUE_SIZE,
  type MusicQueue,
} from '../queue.js';
import { confirm, runMusicCommand, searchTracks } from './shared.js';

/**
 * /play — search or resolve a link, enqueue it, and start playback.
 *
 * Phase 6: the queue mutation (create/connect/insert/start) runs inside
 * the per-guild lock with voice state revalidated immediately before it
 * (P1-06), and playlist insertion is capacity-checked BEFORE inserting —
 * discord-player v7's addTrack throws at the cap instead of truncating
 * (G13a/P2-12), so the room is computed and the playlist sliced here.
 *
 * Phase 6c (R5): the in-lock revalidation is checkAccessFresh — a
 * FORCED member fetch with NO snapshot fallback (the Phase 6 helper
 * fell back to the stale interaction snapshot when the fetch failed,
 * so a failed freshness check still mutated on stale data). A flow
 * that CREATES the connection re-checks once more after connecting:
 * the invoker must still be in the channel the bot just joined.
 */
export const playCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('play a song!')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option.setName('song').setDescription('the song you want to play').setRequired(true),
    ),
  policy: { guildOnly: true },

  async execute(ctx, interaction) {
    await runMusicCommand(ctx, interaction, 'none', async ({ memberChannel }) => {
      const textChannel = textChannelOf(interaction);
      if (memberChannel === null || interaction.guildId === null || textChannel === null) {
        throw new MusicError('You are not in a voice channel.');
      }
      const guildId = interaction.guildId;
      const query = interaction.options.getString('song', true);
      const result = await searchTracks(ctx, interaction, query);

      await withGuildQueueLock(guildId, async () => {
        const access = await checkAccessFresh(ctx, interaction, 'none');
        if (!access.ok) {
          throw new MusicError(
            access.error === NOT_IN_VOICE_MESSAGE
              ? 'You left the voice channel while I was searching.'
              : access.error,
          );
        }
        const freshChannel = access.session.memberChannel;
        if (freshChannel === null) {
          throw new MusicError('You left the voice channel while I was searching.');
        }

        const queue = ensureQueue(ctx.player, guildId, {
          channel: textChannel,
          requestedById: interaction.user.id,
        });

        if (queue.connection === null) {
          try {
            await connectQueue(queue, freshChannel);
          } catch {
            // A brand-new, still-empty queue that cannot connect is useless.
            if (queue.currentTrack === null && queue.tracks.size === 0) queue.delete();
            throw new MusicError("I can't join the voice channel — try again? ❌");
          }
          // Post-connect recheck (R5): connecting awaited I/O too —
          // the invoker must still be in the channel the bot joined.
          const recheck = await checkAccessFresh(ctx, interaction, 'none');
          const recheckChannel = recheck.ok ? recheck.session.memberChannel : null;
          if (recheckChannel === null || recheckChannel.id !== freshChannel.id) {
            if (queue.currentTrack === null && queue.tracks.size === 0) queue.delete();
            throw new MusicError('You left the voice channel while I was connecting.');
          }
        }

        const room = MAX_QUEUE_SIZE - queue.tracks.size;
        if (room <= 0) throw new MusicError(`The queue is full (max ${MAX_QUEUE_SIZE} tracks).`);

        const wasPlaying = queue.isPlaying();
        const playlist = result.playlist ?? null;
        if (result.hasPlaylist() && playlist !== null) {
          const fitting = result.tracks.slice(0, room);
          addTracksGuarded(queue, fitting);
          if (!wasPlaying) await startPlayback(queue);
          await confirm(
            interaction,
            fitting.length < result.tracks.length
              ? `Added **${fitting.length}** track(s) from the playlist **${playlist.title}** (the queue is full, so the rest did not fit) 🎧`
              : `Added **${fitting.length}** track(s) from the playlist **${playlist.title}** 🎧`,
          );
          return;
        }

        const track = result.tracks[0];
        if (track === undefined) {
          throw new MusicError(`No results found for "${query}" — try again? ❌`);
        }
        addTracksGuarded(queue, track);
        if (!wasPlaying) {
          await startPlayback(queue);
          await confirm(interaction, `🎧 Now playing **${trackDisplayOf(track).title}**`);
        } else {
          await confirm(
            interaction,
            `Added **${trackDisplayOf(track).title}** to the queue at position **#${queue.tracks.size}** 🎧`,
          );
        }
      });
    });
  },
};

/** addTrack with player errors translated (it throws at the cap, G13a). */
function addTracksGuarded(queue: MusicQueue, tracks: Parameters<MusicQueue['addTrack']>[0]): void {
  try {
    queue.addTrack(tracks);
  } catch (error) {
    throw new MusicError(
      describePlayerError(error instanceof Error ? error : new Error(String(error))),
    );
  }
}

async function startPlayback(queue: { node: { play(): Promise<void> } }): Promise<void> {
  try {
    await queue.node.play();
  } catch (error) {
    throw new MusicError(
      describePlayerError(error instanceof Error ? error : new Error(String(error))),
    );
  }
}

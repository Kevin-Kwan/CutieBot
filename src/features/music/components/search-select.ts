import { MessageFlags } from 'discord.js';
import type { ComponentModule } from '../../../core/contracts.js';
import { safeEphemeralReply } from '../../../core/responses.js';
import { trackDisplayOf } from '../embeds.js';
import { MusicError } from '../guards.js';
import { addAndStart, checkAccessFresh } from '../helpers.js';
import { describePlayerError } from '../logic.js';
import { ensureQueue, textChannelOf, withGuildQueueLock } from '../queue.js';
import { searchSessions } from '../sessions.js';

/**
 * Search-result select menu (`music:select:<sessionId>`). User-scoped per
 * PLAN §5: only the member who ran /search may pick from their results.
 *
 * Phase 6 (P1-07/G6): the session is CONSUMED (take) before the first
 * async side effect — the Phase 4 code read it with get(), awaited the
 * queue mutation, and only then took it, so two rapid picks (or a pick
 * racing a duplicate delivery) could both pass validation and double-add.
 * The component defers the update before the slow work and finishes
 * with editReply (G14).
 *
 * Phase 6c (R5): authorization is NO LONGER checked against the
 * pre-lock interaction snapshot — GPT's A/B sequence had the invoker
 * pass the snapshot check in channel A, then insert into a queue the
 * bot was playing in channel B. The access check now runs INSIDE the
 * per-guild lock against a forced-fetch fresh voice state and the
 * CURRENT queue.
 *
 * Phase 6c (R6): the session is restored ONLY when the insertion
 * provably did not happen. The Phase 6 code restored on ANY throw from
 * addAndStart — including a node.play() rejection AFTER addTrack had
 * committed — so a retry inserted the same track a second time. Once
 * insertion commits, the session stays consumed even if play() fails.
 *
 * Phase 6e (R5-B): when the pick has to CONNECT the queue, the fresh
 * check is re-run after the connection lands (via addAndStart's
 * beforeInsert hook) — the invoker leaving during the connect must
 * not result in an insertion.
 */
export const searchSelectComponent: ComponentModule = {
  key: 'music:select',
  args: { count: 1, pattern: /^\d{5,32}$/ },
  async execute(ctx, interaction, args) {
    if (!interaction.isStringSelectMenu()) {
      await safeEphemeralReply(interaction, 'That control is no longer available.');
      return;
    }
    const sessionId = args[0];
    const session = sessionId !== undefined ? searchSessions.take(sessionId) : undefined;
    if (session === undefined || sessionId === undefined) {
      await safeEphemeralReply(
        interaction,
        'Those search results have expired — run /search again.',
      );
      return;
    }
    const restore = (): void => searchSessions.restore(sessionId, session);
    const refuse = async (message: string): Promise<void> => {
      restore();
      await safeEphemeralReply(interaction, message);
    };

    if (session.userId !== interaction.user.id) {
      await refuse('That search belongs to someone else — run your own /search.');
      return;
    }
    if (session.guildId !== interaction.guildId) {
      await refuse('That search belongs to a different server.');
      return;
    }
    const rawIndex = interaction.values[0];
    const index = rawIndex === undefined ? Number.NaN : Number.parseInt(rawIndex, 10);
    const track = Number.isInteger(index) ? session.tracks[index] : undefined;
    if (track === undefined) {
      await refuse('That pick is no longer available.');
      return;
    }

    const textChannel = textChannelOf(interaction);
    if (interaction.guildId === null || textChannel === null) {
      await refuse('Something went wrong while queueing that track.');
      return;
    }
    const guildId = interaction.guildId;

    await interaction.deferUpdate();
    // R6: flips true the moment addTrack commits inside addAndStart.
    let inserted = false;
    const failAfterDefer = async (message: string): Promise<void> => {
      if (!inserted) restore();
      await interaction
        .followUp({ content: message, flags: MessageFlags.Ephemeral })
        .catch(() => undefined);
    };

    try {
      await withGuildQueueLock(guildId, async () => {
        const access = await checkAccessFresh(ctx, interaction, 'none');
        if (!access.ok) throw new MusicError(access.error);
        const { memberChannel } = access.session;
        if (memberChannel === null) {
          throw new MusicError('You are not in a voice channel.');
        }
        const existed = access.session.queue !== null;
        const queue =
          access.session.queue ??
          ensureQueue(ctx.player, guildId, {
            channel: textChannel,
            requestedById: interaction.user.id,
          });
        try {
          await addAndStart(
            queue,
            memberChannel,
            track,
            () => {
              inserted = true;
            },
            // Phase 6e (R5-B): post-connect revalidation. The fresh
            // check above ran BEFORE the connection was established;
            // if the invoker left or moved during the connect, the
            // pick must not insert. Re-run the fresh check and pin
            // the channel to the one being connected.
            async () => {
              const fresh = await checkAccessFresh(ctx, interaction, 'none');
              if (!fresh.ok) throw new MusicError(fresh.error);
              if (fresh.session.memberChannel?.id !== memberChannel.id) {
                throw new MusicError(
                  'You are no longer in the voice channel you queued from — the track was not added.',
                );
              }
            },
          );
        } catch (error) {
          // Orphan cleanup (G6): a queue created by this pick that
          // never got a track must not linger as an empty session.
          if (!existed && !inserted && queue.tracks.size === 0 && !queue.isPlaying()) {
            queue.delete();
          }
          throw error;
        }
      });
    } catch (error) {
      if (error instanceof MusicError) {
        await failAfterDefer(error.message);
        return;
      }
      if (error instanceof Error) {
        await failAfterDefer(describePlayerError(error));
        return;
      }
      throw error;
    }

    await interaction.editReply({
      content: `🎧 **${trackDisplayOf(track).title}** has been added to the queue.`,
      embeds: [],
      components: [],
    });
  },
};

import { MessageFlags, type MessageComponentInteraction } from 'discord.js';
import type { AppContext } from '../../../core/context.js';
import { safeEphemeralReply } from '../../../core/responses.js';
import { MusicError, type QueueNeed } from '../guards.js';
import { checkAccess, checkAccessFresh, type MusicSession } from '../helpers.js';
import { withGuildQueueLock } from '../queue.js';

/** Message shown when a controller button targets a superseded queue. */
export const STALE_SESSION_MESSAGE =
  'That controller belongs to an earlier playback session — use the buttons on the ' +
  'current now-playing message instead.';

export interface MusicComponentOptions {
  /**
   * Phase 6c (R5): re-read voice state with a forced fetch (fail
   * closed) instead of trusting the interaction snapshot. For
   * components whose body awaits before mutating (back).
   */
  readonly fresh?: boolean;
  /** Run the whole check + body inside the per-guild queue lock (R5). */
  readonly locked?: boolean;
}

/**
 * Run a music component body behind the standard guards. Components answer
 * ephemerally (the legacy buttons replied publicly and spammed the bound
 * channel; the now-playing message itself is the public surface). Expected
 * MusicErrors become ephemeral error replies; anything else propagates to
 * the router.
 *
 * Phase 6 (P1-05/G5): when `sessionId` is given (every controller button
 * carries one), it must match the live queue's session token — a button
 * on an old now-playing message must not drive the NEW queue that
 * replaced it.
 */
export async function runMusicComponent(
  ctx: AppContext,
  interaction: MessageComponentInteraction,
  need: QueueNeed | 'none',
  body: (session: MusicSession) => Promise<void>,
  sessionId?: string,
  options?: MusicComponentOptions,
): Promise<void> {
  const run = async (): Promise<void> => {
    const access =
      options?.fresh === true
        ? await checkAccessFresh(ctx, interaction, need)
        : checkAccess(ctx, interaction, need);
    if (!access.ok) {
      await safeEphemeralReply(interaction, access.error);
      return;
    }
    if (
      sessionId !== undefined &&
      access.session.queue !== null &&
      access.session.queue.metadata.sessionId !== sessionId
    ) {
      await safeEphemeralReply(interaction, STALE_SESSION_MESSAGE);
      return;
    }
    try {
      await body(access.session);
    } catch (error) {
      if (error instanceof MusicError) {
        await safeEphemeralReply(interaction, error.message);
        return;
      }
      throw error;
    }
  };

  if (options?.locked === true && interaction.guildId !== null) {
    await withGuildQueueLock(interaction.guildId, run);
    return;
  }
  await run();
}

/**
 * Ephemeral text confirmation for a component action. State-aware
 * (Phase 6c): a component that DEFERRED but has not replied yet is
 * confirmed by EDITING the deferred reply — the Phase 6 code sent a
 * followUp, leaving the deferred placeholder hanging; a component that
 * already replied gets a followUp; a fresh one gets a reply.
 */
export async function confirmEphemeral(
  interaction: MessageComponentInteraction,
  content: string,
): Promise<void> {
  if (interaction.deferred && !interaction.replied) {
    await interaction.editReply({ content });
    return;
  }
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

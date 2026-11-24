import type { Track } from 'discord-player';
import type { VoiceBasedChannel } from 'discord.js';
import type { AppContext } from '../../core/context.js';
import { queueVerdict, voiceVerdict, MusicError, type QueueNeed } from './guards.js';
import { describePlayerError } from './logic.js';
import {
  botVoiceChannelId,
  connectQueue,
  getQueue,
  memberVoiceChannel,
  snapshotOf,
  voiceSnapshotOf,
  MAX_QUEUE_SIZE,
  type MusicQueue,
} from './queue.js';

/**
 * Shared guard plumbing for music commands and components: resolve the
 * guild's queue, snapshot the voice state, and run the pure guards. Reply
 * styling stays with the callers (commands defer + followUp; components
 * reply ephemerally).
 */

export interface InteractionShape {
  readonly guildId: string | null;
  readonly member: unknown;
  readonly guild: unknown;
}

export interface MusicSession {
  /** Non-null whenever the requirement was not 'none' and access passed. */
  readonly queue: MusicQueue | null;
  /** The invoker's voice channel (non-null once the voice guard passed). */
  readonly memberChannel: VoiceBasedChannel | null;
}

export type AccessResult =
  | { readonly ok: true; readonly session: MusicSession }
  | { readonly ok: false; readonly error: string };

export function checkAccess(
  ctx: AppContext,
  interaction: InteractionShape,
  need: QueueNeed | 'none',
): AccessResult {
  const queue = interaction.guildId !== null ? getQueue(ctx.player, interaction.guildId) : null;
  const memberChannel = memberVoiceChannel(interaction);

  const voice = voiceVerdict(
    voiceSnapshotOf({
      memberChannelId: memberChannel?.id ?? null,
      queue,
      botChannelId: botVoiceChannelId(interaction),
    }),
  );
  if (!voice.ok) return voice;

  if (need !== 'none') {
    const verdict = queueVerdict(snapshotOf(queue), need);
    if (!verdict.ok) return verdict;
  }

  return { ok: true, session: { queue, memberChannel } };
}

/** Message when fresh voice state cannot be obtained (fail CLOSED). */
export const VOICE_VERIFY_FAILED_MESSAGE =
  "I couldn't verify your voice state just now — try again.";

/** checkAccess's shape plus the invoking user (for the fresh fetch). */
export interface FreshInteractionShape extends InteractionShape {
  readonly user: { readonly id: string };
}

interface FetchableGuild {
  readonly members?: {
    readonly fetch?: (options: {
      user: string;
      force: boolean;
    }) => Promise<{ voice?: { channel?: VoiceBasedChannel | null } } | null>;
  };
}

/**
 * The Phase 6c (R5) authorization boundary for ASYNC queue mutations:
 * resolve the CURRENT queue and re-read the invoker's voice state with
 * a forced member fetch, then run the same pure guards — all of it
 * meant to run INSIDE the per-guild queue lock, immediately before the
 * mutation. Unlike the Phase 6 /play helper, there is NO snapshot
 * fallback: a failed freshness fetch fails CLOSED (no mutation on
 * stale data), and the bot's channel is taken from the live queue
 * first, so a pick can never insert into a queue playing in a channel
 * the invoker has left.
 */
export async function checkAccessFresh(
  ctx: AppContext,
  interaction: FreshInteractionShape,
  need: QueueNeed | 'none',
): Promise<AccessResult> {
  const queue = interaction.guildId !== null ? getQueue(ctx.player, interaction.guildId) : null;

  const guild = interaction.guild as FetchableGuild | null;
  const members = guild?.members;
  if (typeof members?.fetch !== 'function') {
    return { ok: false, error: VOICE_VERIFY_FAILED_MESSAGE };
  }
  let memberChannel: VoiceBasedChannel | null;
  try {
    // Call fetch as a method ON the manager: discord.js implements it as
    // a prototype method that reads `this.guild` / `this.client`, so a
    // detached reference (`const f = members.fetch; f(...)`) throws a
    // TypeError on every live call (Phase 6d regression, Gemini catch).
    const member = await members.fetch({ user: interaction.user.id, force: true });
    memberChannel = member?.voice?.channel ?? null;
  } catch {
    return { ok: false, error: VOICE_VERIFY_FAILED_MESSAGE };
  }

  const voice = voiceVerdict(
    voiceSnapshotOf({
      memberChannelId: memberChannel?.id ?? null,
      queue,
      botChannelId: botVoiceChannelId(interaction),
    }),
  );
  if (!voice.ok) return voice;

  if (need !== 'none') {
    const verdict = queueVerdict(snapshotOf(queue), need);
    if (!verdict.ok) return verdict;
  }

  return { ok: true, session: { queue, memberChannel } };
}

/**
 * Connect the queue to the voice channel if needed, enqueue a track, and
 * start playback when the player is idle. Shared by /play and the search
 * select-menu pick.
 *
 * Phase 6 (G6/P2-13): failures are translated at this boundary — a full
 * queue (discord-player v7 addTrack THROWS ERR_MAX_SIZE_REACHED instead
 * of truncating) and extractor/playback errors reach callers as
 * MusicErrors with honest messages, never as raw player exceptions.
 */
export async function addAndStart(
  queue: MusicQueue,
  voiceChannel: VoiceBasedChannel,
  track: Track,
  onInserted?: () => void,
  beforeInsert?: () => Promise<void>,
): Promise<void> {
  try {
    if (queue.connection === null) {
      await connectQueue(queue, voiceChannel);
      // Phase 6e (R5-B): a connection was established in THIS call —
      // real time passed since the caller's authorization check, and
      // the invoker may have left or moved channels while the
      // connection was being established. The caller-supplied hook
      // re-validates the invoker's CURRENT voice state and throws
      // (MusicError) to abort BEFORE anything is inserted. It runs
      // only on this branch: when the queue was already connected no
      // connect window opened here, and /play performs its own
      // post-connect check for that flow.
      await beforeInsert?.();
    }
    queue.addTrack(track);
    // Phase 6c (R6): the insertion has COMMITTED at this point. The
    // callback lets callers distinguish "never inserted" (safe to
    // restore a consumed session) from "inserted, then play() failed"
    // (restoring would let the user insert the same track twice).
    onInserted?.();
    if (!queue.isPlaying()) await queue.node.play();
  } catch (error) {
    if (error instanceof MusicError) throw error;
    if (error instanceof Error) {
      if (/ERR_MAX_SIZE_REACHED|max size|queue is full/i.test(error.message)) {
        throw new MusicError(`The queue is full (max ${MAX_QUEUE_SIZE} tracks).`);
      }
      throw new MusicError(describePlayerError(error));
    }
    throw error;
  }
}

/**
 * Music access guards (PLAN §5, §7) — pure functions over plain snapshots
 * so the whole matrix is unit-testable without Discord objects.
 *
 * Legacy parity (AUDIT §1.5, events/interactionCreate.js): every music
 * slash command carried `voiceChannel: true` — the invoker had to be in a
 * voice channel, and in the same one as the bot when the bot was connected.
 * Legacy *buttons* had no checks at all (AUDIT §6); v3 applies the same
 * voice rules to components, per PLAN §5 ("music buttons require same
 * voice channel").
 *
 * DJ mode: the legacy config shipped `DJ.enabled: false` with an empty
 * command list and a placeholder role name — DJ restrictions were never
 * active, so v3 has no requester/DJ restriction. Anyone in the bot's voice
 * channel may control playback.
 */
import { TrustedMessageError } from '../../core/errors.js';

/** Domain error for expected, user-facing music failures. */
export class MusicError extends TrustedMessageError {
  constructor(message: string) {
    super(message);
    this.name = 'MusicError';
  }
}

export const NOT_IN_VOICE_MESSAGE = 'You are not in a voice channel.';
export const DIFFERENT_CHANNEL_MESSAGE = 'You are not in the same voice channel as me.';
export const NO_QUEUE_MESSAGE = 'No music is currently playing.';
export const NOTHING_PLAYING_MESSAGE = 'Nothing is playing right now.';

export interface VoiceSnapshot {
  /** The invoking user's voice channel ID, or null when not in voice. */
  readonly memberChannelId: string | null;
  /** The bot's voice channel ID in this guild, or null when not connected. */
  readonly botChannelId: string | null;
}

export type GuardVerdict = { readonly ok: true } | { readonly ok: false; readonly error: string };

/**
 * The legacy `voiceChannel: true` rule: invoker in voice; when the bot is
 * connected, the invoker must share its channel.
 */
export function voiceVerdict(snapshot: VoiceSnapshot): GuardVerdict {
  if (snapshot.memberChannelId === null) {
    return { ok: false, error: NOT_IN_VOICE_MESSAGE };
  }
  if (snapshot.botChannelId !== null && snapshot.botChannelId !== snapshot.memberChannelId) {
    return { ok: false, error: DIFFERENT_CHANNEL_MESSAGE };
  }
  return { ok: true };
}

export interface QueueSnapshot {
  readonly exists: boolean;
  /** A current track is loaded (playing or paused). */
  readonly hasCurrent: boolean;
  readonly paused: boolean;
  /** Number of upcoming (queued, not yet playing) tracks. */
  readonly upcoming: number;
}

export type QueueNeed = 'exists' | 'active';

/**
 * Queue preconditions. `exists` = a queue object is present (volume,
 * queue listing, stop, leave). `active` = a track is loaded, playing or
 * paused (skip, seek, loop, jump…).
 */
export function queueVerdict(snapshot: QueueSnapshot | null, need: QueueNeed): GuardVerdict {
  if (snapshot === null || !snapshot.exists) {
    return { ok: false, error: NO_QUEUE_MESSAGE };
  }
  if (need === 'active' && !snapshot.hasCurrent) {
    return { ok: false, error: NOTHING_PLAYING_MESSAGE };
  }
  return { ok: true };
}

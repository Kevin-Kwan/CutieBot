import { randomBytes } from 'node:crypto';
import type { GuildQueue, Player } from 'discord-player';
import type { MessageCreateOptions, VoiceBasedChannel } from 'discord.js';
import type { QueueSnapshot, VoiceSnapshot } from './guards.js';
import { DEFAULT_VOLUME } from './logic.js';

/**
 * Queue facade over discord-player's GuildQueue (PLAN §7): one metadata
 * shape, one place that creates queues, and structural snapshot helpers so
 * commands and components never reach into player internals directly.
 */

/** Minimal text-channel surface the music feature needs (event posts). */
export interface MusicTextChannel {
  send(options: MessageCreateOptions): Promise<unknown>;
}

/**
 * Per-guild queue metadata. `channel` is the bound text channel — player
 * events (now-playing, queue end, errors) post there; it rebinds to the
 * most recent play/search invocation. `requestedById` is the session
 * owner: the user who created the queue. `sessionId` is an immutable
 * per-queue token (Phase 6, P1-05/G5): every controller button carries
 * it (`music:skip:<sessionId>`), and clicks against a superseded queue
 * are refused instead of acting on the new session.
 */
export interface MusicQueueMetadata {
  channel: MusicTextChannel;
  readonly requestedById: string;
  readonly sessionId: string;
}

/** A fresh controller-session token (12 hex chars). */
export function newSessionId(): string {
  return randomBytes(6).toString('hex');
}

export type MusicQueue = GuildQueue<MusicQueueMetadata>;

/* In-code queue configuration (PLAN §7: idle cleanup + caps). ---------- */

/** Hard cap on upcoming tracks per guild (playlists truncate to fit). */
export const MAX_QUEUE_SIZE = 500;
/** Leave this long after the voice channel empties before disconnecting. */
export const LEAVE_ON_EMPTY_COOLDOWN_MS = 30_000;
/** Leave this long after the queue finishes before disconnecting. */
export const LEAVE_ON_END_COOLDOWN_MS = 60_000;
/** Leave this long after /stop before disconnecting. */
export const LEAVE_ON_STOP_COOLDOWN_MS = 30_000;

/**
 * Get-or-create the guild's queue with the standard v3 options: legacy
 * parity defaults (self-deaf, volume 75, leave on empty/end) plus the
 * built-in idle timers — discord-player cancels a pending leave when new
 * activity arrives, which is exactly the required idle-cleanup semantics.
 * An existing queue keeps its options; only its text-channel binding is
 * refreshed to the invoking channel.
 */
export function ensureQueue(
  player: Player,
  guildId: string,
  metadata: Omit<MusicQueueMetadata, 'sessionId'> & { sessionId?: string },
): MusicQueue {
  const existing = player.nodes.get<MusicQueueMetadata>(guildId);
  if (existing !== null) {
    // Rebind ONLY the text channel (Phase 6, G5): the Phase 4 code
    // replaced the whole metadata object, silently transferring
    // session ownership (requestedById) to whoever ran /play next and
    // — with session ids — would have invalidated live controllers.
    const prior = existing.metadata;
    existing.setMetadata(
      prior !== null && prior !== undefined
        ? {
            channel: metadata.channel,
            requestedById: prior.requestedById,
            sessionId: prior.sessionId,
          }
        : { ...metadata, sessionId: metadata.sessionId ?? newSessionId() },
    );
    return existing;
  }
  return player.nodes.create<MusicQueueMetadata>(guildId, {
    metadata: { ...metadata, sessionId: metadata.sessionId ?? newSessionId() },
    selfDeaf: true,
    volume: DEFAULT_VOLUME,
    leaveOnEmpty: true,
    leaveOnEmptyCooldown: LEAVE_ON_EMPTY_COOLDOWN_MS,
    leaveOnEnd: true,
    leaveOnEndCooldown: LEAVE_ON_END_COOLDOWN_MS,
    leaveOnStop: true,
    leaveOnStopCooldown: LEAVE_ON_STOP_COOLDOWN_MS,
    maxSize: MAX_QUEUE_SIZE,
  });
}

/** The guild's queue, or null when none exists. */
export function getQueue(player: Player, guildId: string): MusicQueue | null {
  return player.nodes.get<MusicQueueMetadata>(guildId);
}

/**
 * Narrow an interaction's channel to the send-capable shape queue
 * metadata needs (DM/group-DM channel variants lack `send` in the union).
 */
export function textChannelOf(interaction: { readonly channel: unknown }): MusicTextChannel | null {
  const channel = interaction.channel as MusicTextChannel | null;
  if (channel === null || typeof channel.send !== 'function') return null;
  return channel;
}

/**
 * Connect a queue to a voice channel. The cast bridges the discord.js
 * dual-typings identity clash documented in src/index.ts (discord-player's
 * typings resolve the CJS copy of discord.js, this tree the ESM copy; the
 * runtime class is the same).
 */
export async function connectQueue(queue: MusicQueue, channel: VoiceBasedChannel): Promise<void> {
  await queue.connect(channel as unknown as Parameters<MusicQueue['connect']>[0]);
}

/** Structural snapshot of a queue for the pure guards. */
export function snapshotOf(queue: MusicQueue | null): QueueSnapshot | null {
  if (queue === null) return null;
  return {
    exists: !queue.deleted,
    hasCurrent: queue.currentTrack !== null,
    paused: queue.node.isPaused(),
    upcoming: queue.tracks.size,
  };
}

/** Structural voice snapshot for the pure guards. */
export function voiceSnapshotOf(input: {
  readonly memberChannelId: string | null;
  readonly queue: MusicQueue | null;
  readonly botChannelId: string | null;
}): VoiceSnapshot {
  return {
    memberChannelId: input.memberChannelId,
    botChannelId: input.queue?.channel?.id ?? input.botChannelId,
  };
}

/**
 * Extract the invoking member's voice channel from an interaction-shaped
 * object. `interaction.member` is a full GuildMember for real interactions;
 * the structural read keeps this usable from commands and components alike.
 */
export function memberVoiceChannel(interaction: {
  readonly member: unknown;
}): VoiceBasedChannel | null {
  const member = interaction.member as {
    voice?: { channel?: VoiceBasedChannel | null };
  } | null;
  return member?.voice?.channel ?? null;
}

/** The bot's current voice channel ID in the guild, from interaction state. */
export function botVoiceChannelId(interaction: { readonly guild: unknown }): string | null {
  const guild = interaction.guild as {
    members?: { me?: { voice?: { channelId?: string | null } } };
  } | null;
  return guild?.members?.me?.voice?.channelId ?? null;
}

/* Per-guild queue-mutation lock (Phase 6, P1-06) ---------------------- */

const guildLocks = new Map<string, Promise<void>>();

/**
 * Serialize queue create/connect/insert/start per guild: two members
 * racing /play (or a play racing a search-select pick) must not both
 * observe "no queue" and interleave connects and inserts. The chain is
 * promise-based and self-cleaning; a failed section does not poison
 * the next one.
 */
export async function withGuildQueueLock<T>(
  guildId: string,
  section: () => Promise<T>,
): Promise<T> {
  const previous = guildLocks.get(guildId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chain = previous.then(() => gate);
  guildLocks.set(guildId, chain);
  await previous;
  try {
    return await section();
  } finally {
    release();
    if (guildLocks.get(guildId) === chain) guildLocks.delete(guildId);
  }
}

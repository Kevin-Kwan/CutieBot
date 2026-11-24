import type { Player, Track } from 'discord-player';
import type { MessageCreateOptions } from 'discord.js';
import { serializeError } from '../../core/errors.js';
import type { AppLogger } from '../../core/logger.js';
import { NO_MENTIONS } from '../../shared/mentions.js';
import { controllerRow } from './components/controller.js';
import { nowPlayingEmbed, trackDisplayOf } from './embeds.js';
import { describePlayerError } from './logic.js';
import type { MusicQueue } from './queue.js';

/**
 * Player event handlers (PLAN §7) — the v3 counterpart of the legacy
 * src/events.js, with two deliberate fixes: every channel post is awaited
 * inside a catch (legacy fired un-awaited sends that assumed
 * queue.metadata.channel always existed), and the now-playing message
 * posts on EVERY track start (the legacy `loopMessage` condition was
 * inverted — AUDIT §5.32 — so it only posted when repeat mode was off).
 *
 * Phase 6 (P1-13/P2-08/P2-13): sendNowPlaying can NEVER reject — the
 * embed build (extractor-controlled titles/URLs, progress-bar creation)
 * happens inside the same try/catch as the post, so the `void` call in
 * the event handler cannot produce an unhandled rejection. Every post
 * carries allowedMentions with parsing disabled: track titles are
 * extractor-controlled text and must never ping. Now-playing posts are
 * throttled per guild so a fast-skipping session cannot flood the
 * bound channel.
 */

const NOW_PLAYING_THROTTLE_MS = 3_000;
const lastNowPlayingAt = new Map<string, number>();

async function post(
  queue: MusicQueue,
  logger: AppLogger,
  options: MessageCreateOptions,
): Promise<void> {
  const channel = queue.metadata?.channel;
  if (channel === undefined || channel === null) return;
  try {
    await channel.send({ allowedMentions: NO_MENTIONS, ...options });
  } catch (error) {
    logger.error(
      { error: serializeError(error), guildId: queue.id },
      'failed to post music event message',
    );
  }
}

/** Build and post the now-playing message with controller buttons. */
export async function sendNowPlaying(
  queue: MusicQueue,
  logger: AppLogger,
  track?: Track,
): Promise<void> {
  try {
    const now = Date.now();
    const last = lastNowPlayingAt.get(queue.id) ?? 0;
    if (now - last < NOW_PLAYING_THROTTLE_MS) return;
    lastNowPlayingAt.set(queue.id, now);

    const current = track ?? queue.currentTrack;
    if (current === null) return;
    const embed = nowPlayingEmbed({
      track: trackDisplayOf(current),
      voiceChannelName: queue.channel?.name ?? null,
      progressBar: queue.node.createProgressBar(),
      volume: queue.node.volume,
      repeatMode: queue.repeatMode,
      paused: queue.node.isPaused(),
    });
    await post(queue, logger, {
      embeds: [embed],
      components: [controllerRow(queue.metadata.sessionId)],
    });
  } catch (error) {
    logger.error(
      { error: serializeError(error), guildId: queue.id },
      'failed to build now-playing message',
    );
  }
}

export function attachMusicEvents(player: Player, logger: AppLogger): void {
  player.events.on('playerStart', (queue, track) => {
    void sendNowPlaying(queue as MusicQueue, logger, track);
  });

  player.events.on('audioTrackAdd', (queue, track) => {
    void post(queue as MusicQueue, logger, {
      // Phase 6c (P1-13 minor): extractor-controlled titles go through
      // the sanitized display projection, never raw into a message.
      content: `Track **${trackDisplayOf(track).title}** added to the queue ✅`,
    });
  });

  player.events.on('audioTracksAdd', (queue) => {
    void post(queue as MusicQueue, logger, {
      content: 'All the songs in the playlist were added to the queue ✅',
    });
  });

  player.events.on('emptyQueue', (queue) => {
    void post(queue as MusicQueue, logger, {
      content: 'I finished playing the whole queue ✅',
    });
  });

  player.events.on('emptyChannel', (queue) => {
    void post(queue as MusicQueue, logger, {
      content: 'Nobody is in the voice channel, leaving the voice channel… ❌',
    });
  });

  player.events.on('disconnect', (queue) => {
    void post(queue as MusicQueue, logger, {
      content: 'I was disconnected from the voice channel, clearing the queue… ❌',
    });
  });

  // Queue-level errors: log with context and tell the bound channel.
  player.events.on('error', (queue, error) => {
    logger.error({ error: serializeError(error), guildId: queue.id }, 'music queue error');
    void post(queue as MusicQueue, logger, { content: describePlayerError(error) });
  });

  // Playback/stream errors (this is where a YouTube bot-check surfaces).
  player.events.on('playerError', (queue, error, track) => {
    logger.error(
      { error: serializeError(error), guildId: queue.id, track: trackDisplayOf(track).title },
      'music playback error',
    );
    void post(queue as MusicQueue, logger, { content: describePlayerError(error) });
  });
}

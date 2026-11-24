import type { Track } from 'discord-player';
import { EmbedBuilder } from 'discord.js';
import { BRAND_COLOR } from '../../shared/embeds.js';
import { loopModeName, paginate, type Page } from './logic.js';

/**
 * Music embed builders over plain display data, so they are testable
 * without live Track objects. `trackDisplayOf` is the only place that
 * reads a real Track's fields for display.
 */

export interface TrackDisplay {
  readonly title: string;
  readonly author: string;
  readonly url: string;
  readonly thumbnail: string | null;
  /** Pre-formatted duration string from the extractor, e.g. "3:45". */
  readonly duration: string;
  readonly requestedByName: string | null;
}

/**
 * Phase 6 (P1-13/P3): extractor metadata is UNTRUSTED display input.
 * Discord rejects embeds whose title/author exceed 256 chars or whose
 * URL is not a valid http(s) URL of ≤2048 chars — one malformed track
 * used to break the whole now-playing post. Clamp and validate here,
 * the single place Track fields are read for display.
 */
const MAX_TITLE_CHARS = 256;
const MAX_AUTHOR_CHARS = 256;
const MAX_URL_CHARS = 2048;

function clampText(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function validHttpUrl(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '' || value.length > MAX_URL_CHARS) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

export function trackDisplayOf(track: Track): TrackDisplay {
  return {
    title: clampText(track.title, MAX_TITLE_CHARS),
    author: clampText(track.author, MAX_AUTHOR_CHARS),
    url: validHttpUrl(track.url) ?? '',
    thumbnail: validHttpUrl(track.thumbnail),
    duration: track.duration,
    requestedByName: track.requestedBy?.username ?? null,
  };
}

const LOOP_ICONS: Readonly<Record<string, string>> = {
  disabled: '',
  track: '🔂',
  queue: '🔁',
  autoplay: '▶️',
};

export function nowPlayingEmbed(input: {
  readonly track: TrackDisplay;
  readonly voiceChannelName: string | null;
  readonly progressBar: string | null;
  readonly volume: number;
  readonly repeatMode: number;
  readonly paused: boolean;
}): EmbedBuilder {
  const { track } = input;
  const loopName = loopModeName(input.repeatMode);
  const lines = [
    `Volume **${input.volume}**%`,
    `Duration **${track.duration}**`,
    `Loop mode **${loopName}**`,
  ];
  if (input.progressBar !== null) lines.push(`Progress ${input.progressBar}`);
  if (track.requestedByName !== null) lines.push(`Requested by ${track.requestedByName}`);
  if (input.paused) lines.push('⏸️ Paused');

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setAuthor({
      name: clampText(
        input.voiceChannelName !== null
          ? `Now playing in ${input.voiceChannelName} 🎧`
          : 'Now playing 🎧',
        MAX_AUTHOR_CHARS,
      ),
    })
    .setTitle(track.title)
    .setDescription(lines.join('\n'))
    .setTimestamp();
  if (track.url !== '') embed.setURL(track.url);
  if (track.thumbnail !== null) embed.setThumbnail(track.thumbnail);
  return embed;
}

export function queueListEmbed(input: {
  readonly guildName: string;
  readonly current: TrackDisplay | null;
  readonly page: Page<TrackDisplay>;
  readonly totalUpcoming: number;
  readonly repeatMode: number;
}): EmbedBuilder {
  const loopIcon = LOOP_ICONS[loopModeName(input.repeatMode)] ?? '';
  const lines: string[] = [];
  if (input.current !== null) {
    lines.push(`**Now playing:** ${input.current.title}`, '');
  }
  if (input.page.items.length === 0) {
    lines.push('No tracks are queued after the current one.');
  } else {
    for (const [offset, track] of input.page.items.entries()) {
      const requested =
        track.requestedByName !== null ? ` (requested by ${track.requestedByName})` : '';
      lines.push(
        `**${input.page.startIndex + offset + 1}.** ${track.title} | ${track.author}${requested}`,
      );
    }
  }
  lines.push(
    '',
    input.totalUpcoming === 0
      ? 'The queue is empty.'
      : `**${input.totalUpcoming}** track(s) in the queue — page ${input.page.page}/${input.page.pageCount}`,
  );

  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setAuthor({ name: `Server queue — ${input.guildName} ${loopIcon}`.trimEnd() })
    .setDescription(lines.join('\n'))
    .setTimestamp();
}

/** Convenience: paginate + build the queue embed in one call. */
export function queuePageEmbed(input: {
  readonly guildName: string;
  readonly current: TrackDisplay | null;
  readonly upcoming: readonly TrackDisplay[];
  readonly requestedPage: number;
  readonly repeatMode: number;
}): EmbedBuilder {
  return queueListEmbed({
    guildName: input.guildName,
    current: input.current,
    page: paginate(input.upcoming, input.requestedPage),
    totalUpcoming: input.upcoming.length,
    repeatMode: input.repeatMode,
  });
}

export function searchResultsEmbed(query: string, tracks: readonly TrackDisplay[]): EmbedBuilder {
  const lines = tracks.map(
    (track, index) => `**${index + 1}.** ${track.title} | ${track.author} — ${track.duration}`,
  );
  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setAuthor({ name: `Results for ${query}` })
    .setDescription([...lines, '', 'Pick a track from the menu below.'].join('\n'))
    .setTimestamp();
}

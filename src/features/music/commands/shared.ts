import { QueryType, type SearchResult } from 'discord-player';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { AppContext } from '../../../core/context.js';
import { deferIfNeeded } from '../../../core/responses.js';
import { errorEmbed } from '../../../shared/embeds.js';
import { NO_MENTIONS } from '../../../shared/mentions.js';
import { MusicError, type QueueNeed } from '../guards.js';
import { checkAccess, type MusicSession } from '../helpers.js';
import { classifyQuery } from '../logic.js';
import { SOUNDCLOUD_EXTRACTOR_ID, YOUTUBE_EXTRACTOR_ID } from '../player.js';

/**
 * Run a music command body: defer first (searches and connects are slow),
 * then the standard guards, then the body. Expected MusicErrors render as
 * error embeds; anything else propagates to the router's generic surface.
 *
 * Phase 6 (G14/P1-11): the initial response is the deferred reply itself
 * (editReply everywhere — followUp left `replied` false and let a later
 * error overwrite the answer), and an expired interaction aborts before
 * any guard or mutation runs.
 */
export async function runMusicCommand(
  ctx: AppContext,
  interaction: ChatInputCommandInteraction,
  need: QueueNeed | 'none',
  body: (session: MusicSession) => Promise<void>,
): Promise<void> {
  const ack = await deferIfNeeded(interaction);
  if (ack === 'expired') return;
  const access = checkAccess(ctx, interaction, need);
  if (!access.ok) {
    await interaction.editReply({ embeds: [errorEmbed(access.error)] });
    return;
  }
  try {
    await body(access.session);
  } catch (error) {
    if (error instanceof MusicError) {
      await interaction.editReply({ embeds: [errorEmbed(error.message)] });
      return;
    }
    throw error;
  }
}

/**
 * The explicit search engine for a classified URL (Phase 6, P1-08):
 * QueryType.AUTO would let extractor internals decide what a URL means
 * (including direct-media resolution); naming the engine per platform
 * keeps resolution on the registered platform extractors only.
 */
function queryTypeForUrl(query: string, host: string): QueryType {
  if (host.includes('youtube') || host === 'youtu.be') {
    return /[?&]list=/.test(query) ? QueryType.YOUTUBE_PLAYLIST : QueryType.YOUTUBE_VIDEO;
  }
  if (host.includes('soundcloud')) {
    return /\/sets\//.test(query) ? QueryType.SOUNDCLOUD_PLAYLIST : QueryType.SOUNDCLOUD_TRACK;
  }
  if (host.includes('spotify')) {
    if (query.includes('/playlist/')) return QueryType.SPOTIFY_PLAYLIST;
    if (query.includes('/album/')) return QueryType.SPOTIFY_ALBUM;
    return QueryType.SPOTIFY_SONG;
  }
  if (host.includes('apple')) {
    if (query.includes('/playlist/')) return QueryType.APPLE_MUSIC_PLAYLIST;
    if (query.includes('/album/')) return QueryType.APPLE_MUSIC_ALBUM;
    return QueryType.APPLE_MUSIC_SONG;
  }
  if (host.includes('vimeo')) return QueryType.VIMEO;
  return QueryType.REVERBNATION;
}

/**
 * Search with the direct-URL guard applied first (PLAN §7 SSRF rule):
 * non-platform URLs never reach the extractors. Throws MusicError for
 * refused queries and empty results.
 *
 * Phase 6c (B2 / GPT NEW-05): text searches no longer hardcode the
 * YouTube engine. PLAN §7's reliability floor says search must survive
 * a dead YouTube path — the extractor may have failed to register at
 * boot (setupMusicPlayer degrades instead of failing), or YouTube
 * search may throw/be blocked from a datacenter IP while SoundCloud is
 * healthy. So: YouTube search only when the YouTube extractor is
 * actually registered, otherwise SoundCloud; and a YouTube throw/empty
 * falls back ONCE to SoundCloud when it is registered. URL queries pass
 * the classifier's NORMALIZED url to the player (never the raw input).
 */
export async function searchTracks(
  ctx: AppContext,
  interaction: ChatInputCommandInteraction,
  query: string,
): Promise<SearchResult> {
  const classification = classifyQuery(query);
  if (classification.kind === 'refused') throw new MusicError(classification.error);

  // A user ID string: player.search resolves it to the User object, and
  // it sidesteps the discord.js dual-typings clash on the User class.
  const requestedBy = interaction.user.id;

  if (classification.kind === 'url') {
    const result = await ctx.player.search(classification.url, {
      requestedBy,
      searchEngine: queryTypeForUrl(classification.url, classification.host),
    });
    if (result.isEmpty() || result.tracks.length === 0) {
      throw new MusicError(`No results found for "${query}" — try again? ❌`);
    }
    return result;
  }

  const store = ctx.player.extractors.store;
  const youtubeAvailable = store.has(YOUTUBE_EXTRACTOR_ID);
  const soundcloudAvailable = store.has(SOUNDCLOUD_EXTRACTOR_ID);
  const primary = youtubeAvailable ? QueryType.YOUTUBE_SEARCH : QueryType.SOUNDCLOUD_SEARCH;

  let result: SearchResult | null = null;
  let primaryError: Error | null = null;
  try {
    result = await ctx.player.search(query, { requestedBy, searchEngine: primary });
  } catch (error) {
    primaryError = error instanceof Error ? error : new Error(String(error));
  }

  const primaryEmpty = result === null || result.isEmpty() || result.tracks.length === 0;
  if (primaryEmpty && primary === QueryType.YOUTUBE_SEARCH && soundcloudAvailable) {
    try {
      result = await ctx.player.search(query, {
        requestedBy,
        searchEngine: QueryType.SOUNDCLOUD_SEARCH,
      });
    } catch {
      result = null;
    }
  }

  if (result === null || result.isEmpty() || result.tracks.length === 0) {
    // No fallback produced results: a thrown primary error keeps its
    // original surface (extractor failure ≠ "no results").
    if (primaryError !== null) throw primaryError;
    throw new MusicError(`No results found for "${query}" — try again? ❌`);
  }
  return result;
}

/**
 * Answer with a plain confirmation line (the deferred reply itself).
 * Phase 6c (P1-13 minor): confirmations interpolate extractor-controlled
 * titles — they must never ping, so NO_MENTIONS rides along.
 */
export async function confirm(
  interaction: ChatInputCommandInteraction,
  content: string,
): Promise<void> {
  await interaction.editReply({ content, allowedMentions: NO_MENTIONS });
}

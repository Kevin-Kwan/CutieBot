import {
  AppleMusicExtractor,
  AttachmentExtractor,
  DefaultExtractors,
  ReverbnationExtractor,
  SoundCloudExtractor,
  SpotifyExtractor,
  VimeoExtractor,
} from '@discord-player/extractor';
import type { Player } from 'discord-player';
import { YoutubeExtractor } from 'discord-player-youtubei';
import type { AppConfig } from '../../config/env.js';
import { serializeError } from '../../core/errors.js';
import type { AppLogger } from '../../core/logger.js';

/**
 * Player bootstrap (PLAN §7): extractors are registered exactly once, here
 * at boot — the legacy bot registered them as require-time side effects in
 * both play.js and playnext.js (AUDIT §5.29).
 *
 * YouTube strategy (AUDIT §5.17/§5.28, PLAN §7): the v3 YoutubeExtractor
 * (discord-player-youtubei 3.x) with its automatic token handling — there
 * is deliberately NO static PO-token env var. An optional burner-account
 * cookie (YOUTUBE_COOKIE) is passed through when configured; it is never
 * required and boot never blocks on YouTube.
 *
 * SSRF: the AttachmentExtractor (streams arbitrary direct file URLs) is
 * excluded from the default bundle, and the command layer refuses
 * non-platform URLs (see logic.ts classifyQuery). Only extractor-resolved
 * sources can ever play.
 */

export const YOUTUBE_EXTRACTOR_ID = YoutubeExtractor.identifier;

/** SoundCloud extractor identifier (Phase 6c, B2: the search fallback). */
export const SOUNDCLOUD_EXTRACTOR_ID = SoundCloudExtractor.identifier;

/** Identifiers expected from the default bundle (attachment excluded). */
export const DEFAULT_EXTRACTOR_IDS: readonly string[] = [
  SoundCloudExtractor.identifier,
  VimeoExtractor.identifier,
  ReverbnationExtractor.identifier,
  AppleMusicExtractor.identifier,
  SpotifyExtractor.identifier,
];

export interface MusicSetupStatus {
  /** Identifiers of the extractors that ended up registered. */
  readonly registered: readonly string[];
  /** Identifiers whose registration was attempted and failed (Phase 6). */
  readonly failed: readonly string[];
  readonly youtubeRegistered: boolean;
}

/**
 * Register all extractors and the player-level error listener. Never
 * throws: a failing optional extractor degrades the feature, not the boot
 * (PLAN §11). Returns what actually registered so callers/tests can see.
 */
export async function setupMusicPlayer(
  player: Player,
  config: AppConfig,
  logger: AppLogger,
): Promise<MusicSetupStatus> {
  // Player-level errors (not tied to a queue) must never be unhandled —
  // an EventEmitter 'error' with no listener throws.
  player.on('error', (error) => {
    logger.error({ err: serializeError(error) }, 'music player error');
  });

  const bundle = DefaultExtractors.filter(
    (extractor) => extractor.identifier !== AttachmentExtractor.identifier,
  );

  // Phase 6 (P2-13): register the bundle ONE extractor at a time so a
  // single broken extractor degrades alone instead of taking the whole
  // bundle down with it (loadMulti was all-or-nothing).
  const failed: string[] = [];
  for (const extractor of bundle) {
    try {
      await player.extractors.loadMulti([extractor]);
      if (!player.extractors.store.has(extractor.identifier)) {
        failed.push(extractor.identifier);
        logger.error(
          { extractor: extractor.identifier },
          'music extractor did not register (activation returned no instance)',
        );
      }
    } catch (error) {
      failed.push(extractor.identifier);
      logger.error(
        { err: serializeError(error), extractor: extractor.identifier },
        'failed to load music extractor',
      );
    }
  }

  let youtubeRegistered = false;
  try {
    const instance = await player.extractors.register(
      YoutubeExtractor,
      config.youtubeCookie !== undefined ? { cookie: config.youtubeCookie } : {},
    );
    youtubeRegistered = instance !== null;
    if (!youtubeRegistered) {
      failed.push(YOUTUBE_EXTRACTOR_ID);
      logger.warn('YouTube extractor failed to activate; YouTube sources unavailable');
    }
  } catch (error) {
    failed.push(YOUTUBE_EXTRACTOR_ID);
    logger.error(
      { err: serializeError(error) },
      'YouTube extractor registration failed; YouTube sources unavailable',
    );
  }

  const registered = [...player.extractors.store.keys()];
  logger.info(
    { extractors: registered, youtubeCookieConfigured: config.youtubeCookie !== undefined },
    'music extractors registered',
  );
  return { registered, failed, youtubeRegistered };
}

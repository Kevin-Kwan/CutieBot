import { QueueRepeatMode } from 'discord-player';
import { parseDuration } from '../../shared/duration.js';

/**
 * Pure music logic (Phase 4) — everything here is free of discord-player
 * runtime objects so it can be unit-tested with plain data: queue-position
 * math, pagination, seek-time parsing, loop transitions, volume steps, the
 * direct-URL guard, and player-error translation.
 */

/** The slice of a track the queue math needs. Real Tracks satisfy this. */
export interface TrackRef {
  readonly title: string;
  readonly url: string;
}

export type LogicResult<T> = { readonly ok: true; readonly value: T } | LogicError;
export interface LogicError {
  readonly ok: false;
  readonly error: string;
}

function fail<T>(error: string): LogicResult<T> {
  return { ok: false, error };
}

/* ------------------------------------------------------------------ */
/* Pagination                                                          */
/* ------------------------------------------------------------------ */

export const QUEUE_PAGE_SIZE = 10;

export interface Page<T> {
  /** 1-based page number, clamped into range. */
  readonly page: number;
  readonly pageCount: number;
  /** Index of the first item on this page within the full list (0-based). */
  readonly startIndex: number;
  readonly items: readonly T[];
}

/** Slice `items` into pages; out-of-range page requests clamp to the ends. */
export function paginate<T>(
  items: readonly T[],
  requestedPage: number,
  pageSize: number = QUEUE_PAGE_SIZE,
): Page<T> {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(Math.max(1, Math.trunc(requestedPage) || 1), pageCount);
  const startIndex = (page - 1) * pageSize;
  return {
    page,
    pageCount,
    startIndex,
    items: items.slice(startIndex, startIndex + pageSize),
  };
}

/* ------------------------------------------------------------------ */
/* Queue position resolution (remove / jump)                           */
/* ------------------------------------------------------------------ */

export interface TrackSelector {
  /** 1-based position in the upcoming queue, as users count tracks. */
  readonly number?: number | null;
  /** Exact track title or URL (legacy matching semantics). */
  readonly song?: string | null;
}

/**
 * Resolve a user's remove/jump selector to a 0-based index into the
 * upcoming-track list. Legacy matched `number` as a 1-based position and
 * `song` by exact title or URL equality; both bugs are fixed (the legacy
 * code dereferenced the track before checking it existed).
 */
export function resolveTrackPosition(
  tracks: readonly TrackRef[],
  selector: TrackSelector,
): LogicResult<number> {
  const { number, song } = selector;

  if (number === undefined || number === null) {
    if (song === undefined || song === null || song.trim() === '') {
      return fail('You have to give a track number or a track name/URL.');
    }
    const index = tracks.findIndex((track) => track.title === song || track.url === song);
    if (index === -1) {
      return fail(`Could not find "${song}" in the queue — try the number or the full title.`);
    }
    return { ok: true, value: index };
  }

  if (!Number.isInteger(number) || number < 1 || number > tracks.length) {
    return fail(
      tracks.length === 0
        ? 'There are no tracks in the queue.'
        : `Track number must be between 1 and ${tracks.length}.`,
    );
  }
  return { ok: true, value: number - 1 };
}

/* ------------------------------------------------------------------ */
/* Move math                                                           */
/* ------------------------------------------------------------------ */

/**
 * Validate a 1-based move within a queue of `size` upcoming tracks and
 * convert to 0-based indices.
 */
export function moveVerdict(
  size: number,
  from: number,
  to: number,
): LogicResult<{ readonly fromIndex: number; readonly toIndex: number }> {
  if (size === 0) return fail('There are no tracks in the queue to move.');
  if (!Number.isInteger(from) || from < 1 || from > size) {
    return fail(`The "from" position must be between 1 and ${size}.`);
  }
  if (!Number.isInteger(to) || to < 1 || to > size) {
    return fail(`The "to" position must be between 1 and ${size}.`);
  }
  if (from === to) return fail('That track is already at that position.');
  return { ok: true, value: { fromIndex: from - 1, toIndex: to - 1 } };
}

/* ------------------------------------------------------------------ */
/* Seek time parsing                                                   */
/* ------------------------------------------------------------------ */

/**
 * Parse a seek target into milliseconds. Accepted forms:
 * - plain seconds: `90`
 * - clock form: `1:30`, `1:02:03`
 * - unit form: `90s`, `1m30s`, `2h` (via shared parseDuration)
 *
 * Zero is a valid seek target (restart the track), unlike moderation
 * durations. The caller checks the result against the track duration.
 */
export function parseSeekTime(input: string): LogicResult<number> {
  const value = input.trim().toLowerCase();
  if (value === '') return fail('Give a time to seek to, like `1:30`, `90`, or `1m30s`.');

  // Phase 6 (G13d): the overflow check must happen BEFORE the ×1000 —
  // a seconds value can be a safe integer while seconds × 1000 is not.
  const maxSeconds = Math.floor(Number.MAX_SAFE_INTEGER / 1_000);

  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    if (!Number.isSafeInteger(seconds) || seconds > maxSeconds) {
      return fail('That time is too large.');
    }
    return { ok: true, value: seconds * 1_000 };
  }

  const clock = /^(\d+):([0-5]\d)(?::([0-5]\d))?$/.exec(value);
  if (clock !== null) {
    const [, first, second, third] = clock;
    const a = Number(first);
    const b = Number(second);
    const totalSeconds = third === undefined ? a * 60 + b : a * 3_600 + b * 60 + Number(third);
    if (!Number.isSafeInteger(totalSeconds) || totalSeconds > maxSeconds) {
      return fail('That time is too large.');
    }
    return { ok: true, value: totalSeconds * 1_000 };
  }

  const parsed = parseDuration(value);
  if (parsed.ok) return { ok: true, value: parsed.ms };
  return fail('I could not understand that time. Try `1:30`, `90`, or `1m30s`.');
}

/* ------------------------------------------------------------------ */
/* Loop / repeat mode                                                  */
/* ------------------------------------------------------------------ */

const LOOP_MODE_NAMES: Readonly<Record<number, string>> = {
  [QueueRepeatMode.OFF]: 'disabled',
  [QueueRepeatMode.TRACK]: 'track',
  [QueueRepeatMode.QUEUE]: 'queue',
  [QueueRepeatMode.AUTOPLAY]: 'autoplay',
};

export function loopModeName(mode: number): string {
  return LOOP_MODE_NAMES[mode] ?? 'disabled';
}

/** Controller-button cycle (legacy buttons): off → track → queue → off. */
export function nextLoopMode(current: number): QueueRepeatMode {
  switch (current) {
    case QueueRepeatMode.OFF:
      return QueueRepeatMode.TRACK;
    case QueueRepeatMode.TRACK:
      return QueueRepeatMode.QUEUE;
    default:
      return QueueRepeatMode.OFF;
  }
}

/**
 * Validate a /loop mode change. Legacy rule: track-loop and queue-loop
 * cannot be switched directly — the current loop must be disabled first.
 */
export function loopTransition(current: number, target: number): LogicResult<number> {
  if (target === current) {
    return fail(`Loop mode is already ${loopModeName(current)}.`);
  }
  const directSwap =
    (current === QueueRepeatMode.TRACK && target === QueueRepeatMode.QUEUE) ||
    (current === QueueRepeatMode.QUEUE && target === QueueRepeatMode.TRACK);
  if (directSwap) {
    return fail('You must first disable the current loop mode (`/loop off`) to switch it.');
  }
  return { ok: true, value: target };
}

/* ------------------------------------------------------------------ */
/* Volume                                                              */
/* ------------------------------------------------------------------ */

export const MAX_VOLUME = 100;
export const DEFAULT_VOLUME = 75;
export const VOLUME_STEP = 5;

/** Validate an explicit /volume value (legacy bounds: 1..maxVol). */
export function volumeVerdict(requested: number, current: number): LogicResult<number> {
  if (!Number.isInteger(requested) || requested < 1 || requested > MAX_VOLUME) {
    return fail(`Volume must be a whole number between 1 and ${MAX_VOLUME}.`);
  }
  if (requested === current) return fail('The volume is already set to that.');
  return { ok: true, value: requested };
}

/**
 * One controller-button volume step (±5, legacy buttons). Phase 6
 * (G13c): the step CLAMPS into [1, MAX_VOLUME] — the Phase 4 code
 * rejected 98 + 5 outright instead of landing on 100, and allowed 0
 * even though /volume enforces a minimum of 1. Only a step taken while
 * already AT the bound is an error.
 */
export function stepVolume(current: number, delta: number): LogicResult<number> {
  const base = Math.floor(current);
  if (delta > 0 && base >= MAX_VOLUME) {
    return fail(`I can't turn the volume up any more (max ${MAX_VOLUME}).`);
  }
  if (delta < 0 && base <= 1) {
    return fail("I can't turn the volume down any more.");
  }
  const next = Math.min(MAX_VOLUME, Math.max(1, base + delta));
  if (next === base) return fail('The volume is already set to that.');
  return { ok: true, value: next };
}

/* ------------------------------------------------------------------ */
/* Direct-URL guard (SSRF)                                             */
/* ------------------------------------------------------------------ */

/**
 * Hosts whose URLs the registered extractors resolve (PLAN §7): YouTube,
 * SoundCloud, Spotify, Vimeo, Apple Music, Reverbnation. Anything else
 * pasted as a URL is refused — the bot never streams arbitrary user-supplied
 * URLs (SSRF guard), and the AttachmentExtractor is not registered.
 */
const ALLOWED_URL_HOSTS: ReadonlySet<string> = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'soundcloud.com',
  'www.soundcloud.com',
  'm.soundcloud.com',
  'on.soundcloud.com',
  'open.spotify.com',
  'play.spotify.com',
  'vimeo.com',
  'www.vimeo.com',
  'player.vimeo.com',
  'music.apple.com',
  'www.reverbnation.com',
  'reverbnation.com',
]);

export type QueryClassification =
  | { readonly kind: 'search' }
  | { readonly kind: 'url'; readonly host: string; readonly url: string }
  | { readonly kind: 'refused'; readonly error: string };

/**
 * Schemeless dangerous prefixes (Phase 6c): these never contain '://'
 * but discord-player's resolvers would still treat them as media
 * sources. Everything else without '://' is free text — INCLUDING
 * titles with colons.
 */
const DANGEROUS_SCHEMELESS = /^(?:file|data|javascript|blob|ftp|vbscript):/i;
const SCHEME_WITH_SLASHES = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Classify a play/search query before it reaches the extractors.
 *
 * Phase 6 (P1-08/G13b): inputs carrying a real URL scheme or a
 * protocol-relative prefix must parse as a plain http(s) URL on an
 * allowlisted host with no credentials and no explicit port, or they
 * are refused; only genuine free text reaches search.
 *
 * Phase 6c (Gemini): the Phase 6 rule treated ANY leading `word:` as a
 * scheme, refusing ordinary titles — "Re:Zero OST" and
 * "NieR:Automata OST" both came back refused, and OST-style titles are
 * a music bot's bread and butter. Scheme detection is now restricted
 * to `scheme://` (plus protocol-relative `//`), with an explicit list
 * of dangerous schemeless prefixes refused. A title containing ':' is
 * a search. Kind 'url' also returns the NORMALIZED URL (https:
 * attached for protocol-relative inputs) and callers pass THAT to the
 * player, never the raw input (GPT P1-08 note).
 */
export function classifyQuery(query: string): QueryClassification {
  const value = query.trim();
  const urlShaped = value.startsWith('//') || SCHEME_WITH_SLASHES.test(value);
  if (!urlShaped) {
    if (DANGEROUS_SCHEMELESS.test(value)) {
      return {
        kind: 'refused',
        error: 'Only http(s) links can be played — other link types are not allowed.',
      };
    }
    return { kind: 'search' };
  }

  let url: URL;
  try {
    url = new URL(value.startsWith('//') ? `https:${value}` : value);
  } catch {
    return { kind: 'refused', error: 'That link does not look like a valid URL.' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return {
      kind: 'refused',
      error: 'Only http(s) links can be played — other link types are not allowed.',
    };
  }
  if (url.username !== '' || url.password !== '') {
    return { kind: 'refused', error: 'Links with embedded credentials are not allowed.' };
  }
  if (url.port !== '') {
    return { kind: 'refused', error: 'Links with an explicit port are not allowed.' };
  }

  const host = url.hostname.toLowerCase();
  if (!ALLOWED_URL_HOSTS.has(host)) {
    return {
      kind: 'refused',
      error:
        'I can only play links from YouTube, SoundCloud, Spotify, Vimeo, Apple Music, ' +
        'or Reverbnation — direct file/stream links are not allowed. Try searching by name instead.',
    };
  }
  return { kind: 'url', host, url: url.toString() };
}

/* ------------------------------------------------------------------ */
/* Player error translation                                            */
/* ------------------------------------------------------------------ */

const YOUTUBE_BLOCK_PATTERNS: readonly RegExp[] = [
  /sign in to confirm/i,
  /not a bot/i,
  /login required/i,
  /please log in/i,
  /age-restricted|age restricted/i,
  /playable in embed/i,
];

const VIDEO_UNAVAILABLE_PATTERNS: readonly RegExp[] = [
  /this video is unavailable/i,
  /video unavailable/i,
  /private video/i,
  /has been removed/i,
];

/**
 * Translate a player/extractor failure into an honest user-facing message.
 * YouTube is experimental on datacenter IPs (PLAN §7): when YouTube blocks
 * playback with its bot-check, say so plainly instead of a generic error.
 * Phase 6 (P2-13): an unavailable/removed video is NOT a bot check and
 * gets its own message — the Phase 4 patterns conflated the two.
 */
export function describePlayerError(error: Error): string {
  const message = error.message ?? '';
  if (YOUTUBE_BLOCK_PATTERNS.some((pattern) => pattern.test(message))) {
    return (
      'YouTube blocked that track — it is asking for a sign-in to confirm the bot is not ' +
      'a robot (a known issue on server IPs; YouTube support is experimental). ' +
      'Try a SoundCloud link or a different search.'
    );
  }
  if (VIDEO_UNAVAILABLE_PATTERNS.some((pattern) => pattern.test(message))) {
    return 'That video is unavailable (removed, private, or region-locked). Try another track.';
  }
  return 'Something went wrong while playing that track.';
}

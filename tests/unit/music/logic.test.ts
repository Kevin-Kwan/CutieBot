import { QueueRepeatMode } from 'discord-player';
import { describe, expect, it } from 'vitest';
import {
  classifyQuery,
  describePlayerError,
  loopModeName,
  loopTransition,
  moveVerdict,
  nextLoopMode,
  paginate,
  parseSeekTime,
  resolveTrackPosition,
  stepVolume,
  volumeVerdict,
  type TrackRef,
} from '../../../src/features/music/logic.js';

const tracks: TrackRef[] = [
  { title: 'Alpha', url: 'https://youtube.com/watch?v=a' },
  { title: 'Beta', url: 'https://youtube.com/watch?v=b' },
  { title: 'Gamma', url: 'https://youtube.com/watch?v=c' },
];

describe('paginate', () => {
  const items = Array.from({ length: 25 }, (_, i) => i + 1);

  it('returns the first page by default size', () => {
    const page = paginate(items, 1);
    expect(page.page).toBe(1);
    expect(page.pageCount).toBe(3);
    expect(page.startIndex).toBe(0);
    expect(page.items).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('returns later pages with the right start index', () => {
    const page = paginate(items, 3);
    expect(page.items).toEqual([21, 22, 23, 24, 25]);
    expect(page.startIndex).toBe(20);
  });

  it('clamps out-of-range pages', () => {
    expect(paginate(items, 99).page).toBe(3);
    expect(paginate(items, 0).page).toBe(1);
    expect(paginate(items, -4).page).toBe(1);
  });

  it('handles an empty list as a single empty page', () => {
    const page = paginate([], 1);
    expect(page.pageCount).toBe(1);
    expect(page.items).toEqual([]);
  });
});

describe('resolveTrackPosition', () => {
  it('resolves a 1-based number to a 0-based index', () => {
    expect(resolveTrackPosition(tracks, { number: 1 })).toEqual({ ok: true, value: 0 });
    expect(resolveTrackPosition(tracks, { number: 3 })).toEqual({ ok: true, value: 2 });
  });

  it('rejects out-of-range numbers', () => {
    expect(resolveTrackPosition(tracks, { number: 0 }).ok).toBe(false);
    expect(resolveTrackPosition(tracks, { number: 4 }).ok).toBe(false);
    expect(resolveTrackPosition(tracks, { number: 1.5 }).ok).toBe(false);
    expect(resolveTrackPosition([], { number: 1 }).ok).toBe(false);
  });

  it('matches by exact title or URL', () => {
    expect(resolveTrackPosition(tracks, { song: 'Beta' })).toEqual({ ok: true, value: 1 });
    expect(resolveTrackPosition(tracks, { song: 'https://youtube.com/watch?v=c' })).toEqual({
      ok: true,
      value: 2,
    });
  });

  it('rejects unknown songs and empty selectors', () => {
    expect(resolveTrackPosition(tracks, { song: 'beta' }).ok).toBe(false);
    expect(resolveTrackPosition(tracks, { song: 'Missing' }).ok).toBe(false);
    expect(resolveTrackPosition(tracks, {}).ok).toBe(false);
    expect(resolveTrackPosition(tracks, { song: '  ' }).ok).toBe(false);
  });

  it('prefers the number when both are given', () => {
    expect(resolveTrackPosition(tracks, { number: 2, song: 'Alpha' })).toEqual({
      ok: true,
      value: 1,
    });
  });
});

describe('moveVerdict', () => {
  it('converts valid 1-based positions to indices', () => {
    expect(moveVerdict(5, 1, 4)).toEqual({ ok: true, value: { fromIndex: 0, toIndex: 3 } });
    expect(moveVerdict(5, 5, 1)).toEqual({ ok: true, value: { fromIndex: 4, toIndex: 0 } });
  });

  it('rejects empty queues, out-of-range positions, and no-ops', () => {
    expect(moveVerdict(0, 1, 1).ok).toBe(false);
    expect(moveVerdict(3, 0, 2).ok).toBe(false);
    expect(moveVerdict(3, 1, 4).ok).toBe(false);
    expect(moveVerdict(3, 2, 2).ok).toBe(false);
    expect(moveVerdict(3, 1.5, 2).ok).toBe(false);
  });
});

describe('parseSeekTime', () => {
  it('parses plain seconds', () => {
    expect(parseSeekTime('90')).toEqual({ ok: true, value: 90_000 });
    expect(parseSeekTime('0')).toEqual({ ok: true, value: 0 });
  });

  it('parses clock forms', () => {
    expect(parseSeekTime('1:30')).toEqual({ ok: true, value: 90_000 });
    expect(parseSeekTime('0:05')).toEqual({ ok: true, value: 5_000 });
    expect(parseSeekTime('1:02:03')).toEqual({ ok: true, value: 3_723_000 });
  });

  it('parses unit forms', () => {
    expect(parseSeekTime('1m30s')).toEqual({ ok: true, value: 90_000 });
    expect(parseSeekTime('45s')).toEqual({ ok: true, value: 45_000 });
    expect(parseSeekTime('2h')).toEqual({ ok: true, value: 7_200_000 });
  });

  it('rejects junk', () => {
    expect(parseSeekTime('').ok).toBe(false);
    expect(parseSeekTime('abc').ok).toBe(false);
    expect(parseSeekTime('1:99').ok).toBe(false);
    expect(parseSeekTime('-30').ok).toBe(false);
    expect(parseSeekTime('1.5m').ok).toBe(false);
  });

  // Phase 6 (G13d): seconds can be a safe integer while seconds*1000
  // is not — the bound must be checked before multiplying.
  it('rejects times whose millisecond value would overflow', () => {
    const tooBigSeconds = String(Math.floor(Number.MAX_SAFE_INTEGER / 1_000) + 1);
    expect(Number.isSafeInteger(Number(tooBigSeconds))).toBe(true);
    expect(parseSeekTime(tooBigSeconds).ok).toBe(false);
    const justFits = String(Math.floor(Number.MAX_SAFE_INTEGER / 1_000));
    expect(parseSeekTime(justFits)).toEqual({
      ok: true,
      value: Number(justFits) * 1_000,
    });
  });
});

describe('loop modes', () => {
  it('names the modes', () => {
    expect(loopModeName(QueueRepeatMode.OFF)).toBe('disabled');
    expect(loopModeName(QueueRepeatMode.TRACK)).toBe('track');
    expect(loopModeName(QueueRepeatMode.QUEUE)).toBe('queue');
    expect(loopModeName(QueueRepeatMode.AUTOPLAY)).toBe('autoplay');
  });

  it('cycles off → track → queue → off for the button', () => {
    expect(nextLoopMode(QueueRepeatMode.OFF)).toBe(QueueRepeatMode.TRACK);
    expect(nextLoopMode(QueueRepeatMode.TRACK)).toBe(QueueRepeatMode.QUEUE);
    expect(nextLoopMode(QueueRepeatMode.QUEUE)).toBe(QueueRepeatMode.OFF);
    expect(nextLoopMode(QueueRepeatMode.AUTOPLAY)).toBe(QueueRepeatMode.OFF);
  });

  it('allows off→anything and anything→off', () => {
    expect(loopTransition(QueueRepeatMode.OFF, QueueRepeatMode.TRACK).ok).toBe(true);
    expect(loopTransition(QueueRepeatMode.OFF, QueueRepeatMode.QUEUE).ok).toBe(true);
    expect(loopTransition(QueueRepeatMode.TRACK, QueueRepeatMode.OFF).ok).toBe(true);
    expect(loopTransition(QueueRepeatMode.QUEUE, QueueRepeatMode.OFF).ok).toBe(true);
    expect(loopTransition(QueueRepeatMode.AUTOPLAY, QueueRepeatMode.TRACK).ok).toBe(true);
  });

  it('refuses direct track↔queue swaps and no-ops (legacy rule)', () => {
    expect(loopTransition(QueueRepeatMode.TRACK, QueueRepeatMode.QUEUE).ok).toBe(false);
    expect(loopTransition(QueueRepeatMode.QUEUE, QueueRepeatMode.TRACK).ok).toBe(false);
    expect(loopTransition(QueueRepeatMode.OFF, QueueRepeatMode.OFF).ok).toBe(false);
    expect(loopTransition(QueueRepeatMode.TRACK, QueueRepeatMode.TRACK).ok).toBe(false);
  });
});

describe('volume', () => {
  it('accepts in-range changes', () => {
    expect(volumeVerdict(50, 75)).toEqual({ ok: true, value: 50 });
    expect(volumeVerdict(100, 75)).toEqual({ ok: true, value: 100 });
    expect(volumeVerdict(1, 75)).toEqual({ ok: true, value: 1 });
  });

  it('rejects out-of-range, fractional, and unchanged values', () => {
    expect(volumeVerdict(0, 75).ok).toBe(false);
    expect(volumeVerdict(101, 75).ok).toBe(false);
    expect(volumeVerdict(50.5, 75).ok).toBe(false);
    expect(volumeVerdict(75, 75).ok).toBe(false);
  });

  it('steps by ±5 within bounds', () => {
    expect(stepVolume(75, 5)).toEqual({ ok: true, value: 80 });
    expect(stepVolume(75, -5)).toEqual({ ok: true, value: 70 });
    expect(stepVolume(100, 5).ok).toBe(false);
    expect(stepVolume(0, -5).ok).toBe(false);
  });

  // Phase 6 (G13c): steps clamp into [1, 100] instead of rejecting.
  it('stepVolume clamps at the bounds', () => {
    expect(stepVolume(98, 5)).toEqual({ ok: true, value: 100 });
    expect(stepVolume(3, -5)).toEqual({ ok: true, value: 1 });
    expect(stepVolume(1, -5).ok).toBe(false); // already at the floor
    expect(stepVolume(5, -5)).toEqual({ ok: true, value: 1 }); // never 0
  });
});

describe('classifyQuery', () => {
  it('treats plain text as a search', () => {
    expect(classifyQuery('lofi beats')).toEqual({ kind: 'search' });
    expect(classifyQuery('never gonna give you up')).toEqual({ kind: 'search' });
  });

  it('allows URLs on extractor-supported hosts', () => {
    expect(classifyQuery('https://www.youtube.com/watch?v=x')).toEqual({
      kind: 'url',
      host: 'www.youtube.com',
      url: 'https://www.youtube.com/watch?v=x',
    });
    expect(classifyQuery('https://youtu.be/x').kind).toBe('url');
    expect(classifyQuery('https://soundcloud.com/artist/track').kind).toBe('url');
    expect(classifyQuery('https://open.spotify.com/track/abc').kind).toBe('url');
    expect(classifyQuery('https://music.apple.com/us/song/x/123').kind).toBe('url');
    expect(classifyQuery('https://vimeo.com/12345').kind).toBe('url');
  });

  it('refuses arbitrary URLs (SSRF guard)', () => {
    expect(classifyQuery('https://example.com/song.mp3').kind).toBe('refused');
    expect(classifyQuery('http://169.254.169.254/latest/meta-data').kind).toBe('refused');
    expect(classifyQuery('https://localhost:8080/admin.mp3').kind).toBe('refused');
    expect(classifyQuery('https://youtube.com.evil.example/watch?v=x').kind).toBe('refused');
  });

  it('refuses malformed URLs', () => {
    expect(classifyQuery('https://').kind).toBe('refused');
  });

  // Phase 6 (P1-08/G13b): scheme-like and protocol-relative inputs
  // must not fall through to AUTO search.
  it('refuses non-http(s) schemes instead of searching them', () => {
    expect(classifyQuery('file:///etc/passwd').kind).toBe('refused');
    expect(classifyQuery('ftp://youtube.com/x').kind).toBe('refused');
    expect(classifyQuery('data:audio/mp3;base64,AAAA').kind).toBe('refused');
  });

  it('refuses protocol-relative URLs to non-allowlisted hosts', () => {
    expect(classifyQuery('//169.254.169.254/latest/meta-data').kind).toBe('refused');
    expect(classifyQuery('//www.youtube.com/watch?v=x').kind).toBe('url');
  });

  it('refuses credential- and port-bearing URLs even on allowed hosts', () => {
    expect(classifyQuery('https://user:pass@www.youtube.com/watch?v=x').kind).toBe('refused');
    expect(classifyQuery('https://www.youtube.com:8443/watch?v=x').kind).toBe('refused');
  });

  // Phase 6c (Gemini): the Phase 6 rule treated any leading `word:`
  // as a scheme and refused ordinary titles — the two OST titles below
  // were reproduced as kind 'refused'. This SUPERSEDES the Phase 6
  // expectation that 'lofi: beats…' is refused: scheme detection now
  // requires '://', plus an explicit dangerous-schemeless list.
  it('treats plain titles containing colons as searches (OST titles)', () => {
    expect(classifyQuery('Re:Zero OST')).toEqual({ kind: 'search' });
    expect(classifyQuery('NieR:Automata OST')).toEqual({ kind: 'search' });
    expect(classifyQuery('lofi: beats to relax to')).toEqual({ kind: 'search' });
    expect(classifyQuery('artist - song: the remix')).toEqual({ kind: 'search' });
  });

  it('refuses dangerous schemeless prefixes', () => {
    expect(classifyQuery('javascript:alert(1)').kind).toBe('refused');
    expect(classifyQuery('file:secret.txt').kind).toBe('refused');
    expect(classifyQuery('blob:https://www.youtube.com/x').kind).toBe('refused');
    expect(classifyQuery('vbscript:msgbox').kind).toBe('refused');
    expect(classifyQuery('ftp:downloads/track').kind).toBe('refused');
  });

  it('returns the NORMALIZED url for protocol-relative inputs', () => {
    expect(classifyQuery('//www.youtube.com/watch?v=x')).toEqual({
      kind: 'url',
      host: 'www.youtube.com',
      url: 'https://www.youtube.com/watch?v=x',
    });
  });
});

describe('describePlayerError', () => {
  it('calls out the YouTube bot-check honestly', () => {
    const message = describePlayerError(new Error('Error: Sign in to confirm you’re not a bot'));
    expect(message).toMatch(/YouTube blocked/);
    expect(message).toMatch(/experimental/);
  });

  it('detects other YouTube availability failures', () => {
    expect(describePlayerError(new Error('Login required'))).toMatch(/YouTube blocked/);
  });

  // Phase 6 (P2-13): unavailable is not a bot check.
  it('reports an unavailable video as unavailable, not as a bot block', () => {
    expect(describePlayerError(new Error('Video unavailable'))).toMatch(/unavailable/);
    expect(describePlayerError(new Error('Video unavailable'))).not.toMatch(/YouTube blocked/);
    expect(describePlayerError(new Error('This video is unavailable'))).toMatch(/unavailable/);
  });

  it('falls back to a generic message', () => {
    expect(describePlayerError(new Error('socket hang up'))).toBe(
      'Something went wrong while playing that track.',
    );
  });
});

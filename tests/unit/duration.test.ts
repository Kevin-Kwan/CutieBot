import { describe, expect, it } from 'vitest';
import { MAX_TIMEOUT_MS, parseDuration } from '../../src/shared/duration.js';

describe('parseDuration — valid input', () => {
  const cases: readonly [string, number][] = [
    ['45s', 45_000],
    ['10m', 600_000],
    ['2h', 7_200_000],
    ['1d', 86_400_000],
    ['1w', 604_800_000],
    ['1d12h', 129_600_000],
    ['1h30m', 5_400_000],
    ['1w2d3h4m5s', 788_645_000],
    [' 10m ', 600_000], // surrounding whitespace is trimmed
    ['10M', 600_000], // case-insensitive units
    ['1D', 86_400_000],
    ['1h1h', 7_200_000], // repeated units sum
  ];

  it.each(cases)('parses %s to %i ms', (input, expected) => {
    expect(parseDuration(input)).toEqual({ ok: true, ms: expected });
  });

  it('accepts up to the timeout cap, held 10s under 28 days (Phase 6, G15)', () => {
    // MAX_TIMEOUT_MS is 28d − 10s so a max-length timeout cannot drift
    // past Discord's deadline in flight; a literal 28d is now refused.
    expect(MAX_TIMEOUT_MS).toBe(28 * 24 * 60 * 60 * 1_000 - 10_000);
    expect(parseDuration('27d23h59m50s', MAX_TIMEOUT_MS)).toEqual({ ok: true, ms: MAX_TIMEOUT_MS });
    expect(parseDuration('28d', MAX_TIMEOUT_MS).ok).toBe(false);
    expect(parseDuration('4w', MAX_TIMEOUT_MS).ok).toBe(false);
  });
});

describe('parseDuration — invalid input', () => {
  const junk: readonly string[] = [
    'abc',
    '10', // missing unit
    '10x', // unknown unit
    'm', // missing amount
    '10.5m', // fractional amounts are not whole numbers
    '-5m', // no signs
    '1h30', // trailing segment without unit
    '10 m', // internal whitespace
    '1,000m', // no separators
  ];

  it.each(junk)('rejects %j', (input) => {
    const result = parseDuration(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Invalid duration/);
  });

  it('rejects empty input with its own message', () => {
    expect(parseDuration('')).toEqual({ ok: false, error: 'Duration cannot be empty.' });
  });

  it('rejects zero totals', () => {
    for (const input of ['0m', '0s', '0h0m', '0w']) {
      const result = parseDuration(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/greater than zero/);
    }
  });
});

describe('parseDuration — bounds', () => {
  it('rejects durations beyond the 28-day timeout cap', () => {
    for (const input of ['29d', '4w1s', '28d1s', '100w']) {
      expect(parseDuration(input, MAX_TIMEOUT_MS)).toEqual({
        ok: false,
        error: 'Duration cannot exceed 28 days.',
      });
    }
  });

  it('rejects unsafe amounts instead of overflowing', () => {
    const result = parseDuration('99999999999999999999999s');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/supported numeric range/);
  });

  it('rejects amounts that would overflow a custom cap mid-parse', () => {
    // 1h fits the cap exactly; the extra 1s must trip the pre-multiplication guard.
    expect(parseDuration('1h1s', 3_600_000)).toEqual({
      ok: false,
      error: 'Duration cannot exceed 3600000 milliseconds.',
    });
    expect(parseDuration('2h', 3_600_000).ok).toBe(false);
    expect(parseDuration('1h', 3_600_000)).toEqual({ ok: true, ms: 3_600_000 });
  });

  it('rejects a non-positive or unsafe maxMs', () => {
    for (const maxMs of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const result = parseDuration('1m', maxMs);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/positive safe integer/);
    }
  });
});

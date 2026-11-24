/**
 * Human duration parsing for moderation timeouts (PLAN §9): one or more
 * `<amount><unit>` segments such as `10m`, `1d12h`, `2w`. Units: s, m, h, d, w.
 *
 * The parser is total — it never throws and never returns a non-positive or
 * unsafe total. Overflow is detected BEFORE each multiplication so a huge
 * input can never wrap into a small, valid-looking duration.
 */

/**
 * Discord's hard cap on communication timeouts: 28 days. Phase 6
 * (G15): the cap is held 10 seconds UNDER the API limit — a duration
 * computed as exactly 28 days can land a hair past Discord's deadline
 * by the time the request arrives and be rejected with 50035.
 */
export const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1_000 - 10_000;

const UNIT_MS: Readonly<Record<string, number>> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

export type DurationResult = { ok: true; ms: number } | { ok: false; error: string };

export function parseDuration(input: string, maxMs?: number): DurationResult {
  const value = input.trim().toLowerCase();

  if (value.length === 0) {
    return { ok: false, error: 'Duration cannot be empty.' };
  }

  if (maxMs !== undefined && (!Number.isSafeInteger(maxMs) || maxMs <= 0)) {
    return { ok: false, error: 'Maximum duration must be a positive safe integer.' };
  }

  const limit = maxMs ?? Number.MAX_SAFE_INTEGER;
  const pattern = /(\d+)([smhdw])/y;

  const overflowError =
    maxMs === MAX_TIMEOUT_MS
      ? 'Duration cannot exceed 28 days.'
      : maxMs !== undefined
        ? `Duration cannot exceed ${maxMs} milliseconds.`
        : 'Duration exceeds the supported numeric range.';

  let offset = 0;
  let totalMs = 0;

  while (offset < value.length) {
    pattern.lastIndex = offset;

    const match = pattern.exec(value);
    const rawAmount = match?.[1];
    const unit = match?.[2];

    if (rawAmount === undefined || unit === undefined) {
      return {
        ok: false,
        error:
          'Invalid duration. Use positive whole numbers with ' +
          's, m, h, d, or w (for example, 10m or 1d12h).',
      };
    }

    const amount = Number(rawAmount);
    const multiplier = UNIT_MS[unit];

    if (multiplier === undefined) {
      return { ok: false, error: `Unsupported duration unit: ${unit}.` };
    }

    // Check before multiplication to prevent numeric overflow
    // and loss of integer precision.
    if (!Number.isSafeInteger(amount) || amount > Math.floor((limit - totalMs) / multiplier)) {
      return { ok: false, error: overflowError };
    }

    totalMs += amount * multiplier;
    offset = pattern.lastIndex;
  }

  if (totalMs <= 0) {
    return { ok: false, error: 'Duration must be greater than zero.' };
  }

  return { ok: true, ms: totalMs };
}

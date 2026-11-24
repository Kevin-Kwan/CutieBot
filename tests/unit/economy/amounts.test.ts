import { describe, expect, it } from 'vitest';
import { parseAmount } from '../../../src/features/economy/amounts.js';

describe('parseAmount — valid inputs', () => {
  const cases: ReadonlyArray<[string, number, number]> = [
    // [input, balance, expected amount]
    ['100', 500, 100],
    ['1', 500, 1],
    [' 250 ', 500, 250],
    ['007', 500, 7],
    ['600', 500, 600], // syntactic only: sufficiency is the caller's check
    ['all', 500, 500],
    ['ALL', 500, 500],
    ['All', 500, 500],
    ['max', 500, 500],
    [' MAX ', 500, 500],
    ['9007199254740991', 500, 9007199254740991], // Number.MAX_SAFE_INTEGER
  ];
  it.each(cases)('parses %j (balance %i) → %i', (input, balance, expected) => {
    expect(parseAmount(input, balance)).toEqual({ ok: true, amount: expected });
  });
});

describe('parseAmount — rejected inputs', () => {
  const cases: ReadonlyArray<[string, number]> = [
    ['all', 0], // nothing to take
    ['max', 0],
    ['all', -100],
    ['0', 500],
    ['00', 500],
    ['-0', 500],
    ['-5', 500],
    ['10.5', 500], // fractional — the old parseInt silently truncated this
    ['10.0', 500],
    ['1e30', 500], // scientific notation
    ['1e3', 500],
    ['Infinity', 500],
    ['-Infinity', 500],
    ['NaN', 500],
    ['abc', 500],
    ['', 500],
    ['   ', 500],
    ['+100', 500],
    ['1,000', 500],
    ['1_000', 500],
    ['0x10', 500],
    ['$100', 500],
    ['9007199254740992', 500], // MAX_SAFE_INTEGER + 1 — unsafe
    ['99999999999999999999999999', 500], // way past safe range
  ];
  it.each(cases)('rejects %j (balance %i)', (input, balance) => {
    const result = parseAmount(input, balance);
    expect(result.ok).toBe(false);
  });

  it('rejects non-string input defensively', () => {
    expect(parseAmount(undefined as unknown as string, 500).ok).toBe(false);
    expect(parseAmount(100 as unknown as string, 500).ok).toBe(false);
  });
});

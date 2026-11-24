import { describe, expect, it } from 'vitest';
import {
  STARTING_BANK,
  STARTING_WALLET,
  normalizeEconomyUser,
  type NormalizeResult,
} from '../../../src/features/economy/types.js';

/** Unwrap an ok result, failing the test loudly otherwise. */
function ok(result: NormalizeResult): Extract<NormalizeResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected ok result, got issues: ${result.issues.join('; ')}`);
  return result;
}

describe('normalizeEconomyUser — clean v3 documents', () => {
  it('passes a well-formed document through unrepaired', () => {
    const { user, repaired, issues } = ok(
      normalizeEconomyUser({
        _id: 'u1',
        userId: 'u1',
        wallet: 1234,
        bank: 56,
        inventory: [{ itemId: 1, qty: 2 }],
        lastDaily: 1700000000000,
        lastWeekly: null,
        lastMonthly: null,
        lastRobbed: null,
      }),
    );
    expect(repaired).toBe(false);
    expect(issues).toEqual([]);
    expect(user).toEqual({
      userId: 'u1',
      wallet: 1234,
      bank: 56,
      inventory: [{ itemId: 1, qty: 2 }],
      lastDaily: 1700000000000,
      lastWeekly: null,
      lastMonthly: null,
      lastRobbed: null,
    });
  });

  it('exposes the old starting balances (wallet 5000, bank 0)', () => {
    expect(STARTING_WALLET).toBe(5000);
    expect(STARTING_BANK).toBe(0);
  });
});

describe('normalizeEconomyUser — legacy shapes', () => {
  it('accepts a legacy bank doc keyed only by _id (old bank_funcs shape)', () => {
    const { user, repaired } = ok(normalizeEconomyUser({ _id: 'legacy-1', wallet: 777, bank: 3 }));
    expect(user.userId).toBe('legacy-1');
    expect(user.wallet).toBe(777);
    expect(user.bank).toBe(3);
    expect(user.inventory).toEqual([]);
    expect(repaired).toBe(true);
  });

  it('converts legacy flat inventory fields (old inventory collection shape)', () => {
    const { user, repaired } = ok(
      normalizeEconomyUser({
        _id: 'legacy-2',
        wallet: 100,
        bank: 0,
        watch: 2,
        mobile: 1,
        laptop: 0,
      }),
    );
    expect(user.inventory).toEqual([
      { itemId: 1, qty: 2 },
      { itemId: 2, qty: 1 },
    ]);
    expect(repaired).toBe(true);
  });

  it('converts an object-map inventory keyed by item name', () => {
    const { user } = ok(
      normalizeEconomyUser({
        userId: 'u2',
        wallet: 0,
        bank: 0,
        inventory: { watch: 3, laptop: 1 },
      }),
    );
    expect(user.inventory).toEqual([
      { itemId: 1, qty: 3 },
      { itemId: 3, qty: 1 },
    ]);
  });

  it('accepts array entries with id/quantity spellings and merges duplicates', () => {
    const { user } = ok(
      normalizeEconomyUser({
        userId: 'u3',
        wallet: 0,
        bank: 0,
        inventory: [
          { id: 2, quantity: 1 },
          { itemId: 2, qty: 2 },
          { itemId: 'nope', qty: 5 },
          'garbage',
        ],
      }),
    );
    expect(user.inventory).toEqual([{ itemId: 2, qty: 3 }]);
  });
});

describe('normalizeEconomyUser — representable coercions', () => {
  it('coerces numeric strings', () => {
    const { user } = ok(normalizeEconomyUser({ userId: 'u', wallet: '7500', bank: '250' }));
    expect(user.wallet).toBe(7500);
    expect(user.bank).toBe(250);
  });

  it('defaults missing and null balances to 0 (nothing existed to lose)', () => {
    for (const missing of [null, undefined]) {
      const { user } = ok(normalizeEconomyUser({ userId: 'u', wallet: missing, bank: missing }));
      expect(user.wallet).toBe(0);
      expect(user.bank).toBe(0);
    }
  });

  it('floors fractional balances', () => {
    const { user } = ok(normalizeEconomyUser({ userId: 'u', wallet: 123.9, bank: 0 }));
    expect(user.wallet).toBe(123);
  });

  it('coerces timestamps from Date and date strings, rejects garbage', () => {
    const when = new Date('2026-01-15T12:00:00Z');
    const { user, issues } = ok(
      normalizeEconomyUser({
        userId: 'u',
        wallet: 0,
        bank: 0,
        lastDaily: when,
        lastWeekly: '2026-01-15T12:00:00.000Z',
        lastMonthly: 'not a date',
        lastRobbed: -5,
      }),
    );
    expect(user.lastDaily).toBe(when.getTime());
    expect(user.lastWeekly).toBe(when.getTime());
    expect(user.lastMonthly).toBeNull();
    expect(user.lastRobbed).toBeNull();
    // Phase 6 (P2-03): the BSON Date coercion is REPORTED — silently
    // converting it used to leave `repaired` false and the Date in
    // the stored document forever.
    expect(issues.some((issue) => issue.includes('lastDaily'))).toBe(true);
  });

  it('reports string inventory quantities and duplicate merges as issues', () => {
    const { user, issues } = ok(
      normalizeEconomyUser({
        userId: 'u',
        wallet: 0,
        bank: 0,
        inventory: [
          { itemId: 1, qty: '2' },
          { itemId: 1, qty: 1 },
        ],
      }),
    );
    expect(user.inventory).toEqual([{ itemId: 1, qty: 3 }]);
    expect(issues.some((issue) => issue.includes('string quantity'))).toBe(true);
    expect(issues.some((issue) => issue.includes('duplicate'))).toBe(true);
  });

  // Phase 6c (R2): quantities must be safe integers — 1e20 is finite
  // and positive, and the Phase 6 code floored it into the record.
  it('drops quantities whose floored value is not a safe integer', () => {
    const { user, issues } = ok(
      normalizeEconomyUser({
        userId: 'u',
        wallet: 0,
        bank: 0,
        inventory: [{ itemId: 1, qty: 1e20 }],
      }),
    );
    expect(user.inventory).toEqual([]);
    expect(issues.some((issue) => issue.includes('safe-integer range dropped'))).toBe(true);
  });

  // Phase 6c (R2): duplicate merges use checked addition — two
  // individually-safe quantities summing past MAX_SAFE_INTEGER reject
  // the record for quarantine instead of wrapping or clamping.
  it('rejects a record whose duplicate merge overflows the safe range', () => {
    const result = normalizeEconomyUser({
      userId: 'u',
      wallet: 0,
      bank: 0,
      inventory: [
        { itemId: 1, qty: Number.MAX_SAFE_INTEGER },
        { itemId: 1, qty: 2 },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.includes('safe-integer range'))).toBe(true);
    }
  });
});

// Phase 6 (P0-01/G10): values that cannot be a balance are NOT reset
// to a fabricated 0 — the record is rejected so the repository can
// quarantine the original and report it (PLAN §6).
describe('normalizeEconomyUser — quarantine cases (ok: false)', () => {
  it('rejects NaN, non-numeric, and wrong-type balances', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 'abc', {}, [], true]) {
      const result = normalizeEconomyUser({ userId: 'u', wallet: bad, bank: 0 });
      expect(result.ok).toBe(false);
    }
  });

  it('rejects negative balances instead of clamping them away', () => {
    expect(normalizeEconomyUser({ userId: 'u', wallet: -50, bank: 0 }).ok).toBe(false);
    expect(normalizeEconomyUser({ userId: 'u', wallet: '-50', bank: 0 }).ok).toBe(false);
  });

  it('rejects balances beyond the safe-integer range (isInteger is not enough)', () => {
    const unsafe = Number.MAX_SAFE_INTEGER + 1;
    expect(Number.isInteger(unsafe)).toBe(true); // the Phase 2 check passed this!
    expect(normalizeEconomyUser({ userId: 'u', wallet: unsafe, bank: 0 }).ok).toBe(false);
    expect(normalizeEconomyUser({ userId: 'u', wallet: String(unsafe), bank: 0 }).ok).toBe(false);
  });

  it('rejects a document whose userId field disagrees with its _id (P2-04)', () => {
    const result = normalizeEconomyUser({ _id: 'alice', userId: 'bob', wallet: 1, bank: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join(' ')).toContain('identity');
  });

  it('rejects non-object documents and documents with no determinable id', () => {
    for (const bad of [null, undefined, 42, 'doc', []]) {
      expect(normalizeEconomyUser(bad).ok).toBe(false);
    }
    expect(normalizeEconomyUser({ wallet: 5, bank: 0 }).ok).toBe(false);
  });
});

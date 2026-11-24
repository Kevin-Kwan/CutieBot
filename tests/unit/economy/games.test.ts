import { describe, expect, it } from 'vitest';
import {
  MIN_BET,
  ROB_COOLDOWN_MS,
  ROB_FINE,
  SLOT_SYMBOLS,
  coinflip,
  dice,
  randInt,
  rob,
  roulette,
  slots,
  type Rng,
} from '../../../src/features/economy/games.js';

/** RNG that returns the same value forever. */
function constRng(value: number): Rng {
  return () => value;
}

/** RNG that walks a fixed sequence (repeating the last value if drained). */
function seqRng(values: readonly number[]): Rng {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)] as number;
    index += 1;
    return value;
  };
}

describe('randInt (old base.js randint semantics: inclusive both ends)', () => {
  it('hits min at rng 0 and max just below rng 1', () => {
    expect(randInt(constRng(0), 3000, 5000)).toBe(3000);
    expect(randInt(constRng(0.999999), 3000, 5000)).toBe(5000);
    expect(randInt(constRng(0), 0, 1)).toBe(0);
    expect(randInt(constRng(0.5), 0, 1)).toBe(1);
  });
});

describe('coinflip', () => {
  it('rng 0 → heads; win pays +bet, loss pays −bet', () => {
    expect(coinflip(constRng(0), 100, 'heads')).toEqual({ result: 'heads', won: true, delta: 100 });
    expect(coinflip(constRng(0), 100, 'tails')).toEqual({
      result: 'heads',
      won: false,
      delta: -100,
    });
  });

  it('rng 0.5 → tails', () => {
    expect(coinflip(constRng(0.5), 250, 'tails')).toEqual({
      result: 'tails',
      won: true,
      delta: 250,
    });
    expect(coinflip(constRng(0.999), 250, 'heads').delta).toBe(-250);
  });
});

describe('roulette', () => {
  it('win on the low half, lose on the high half', () => {
    expect(roulette(constRng(0), 100)).toEqual({ won: true, delta: 100 });
    expect(roulette(constRng(0.4999), 100).won).toBe(true);
    expect(roulette(constRng(0.5), 100)).toEqual({ won: false, delta: -100 });
    expect(roulette(constRng(0.999), 100).won).toBe(false);
  });
});

describe('dice', () => {
  it('rolls a uniform 1–6 across the rng range (never undefined, AUDIT §5.22)', () => {
    const faces = [0, 0.2, 0.4, 0.55, 0.75, 0.95].map((v) => dice(constRng(v), 10, 6).roll);
    expect(faces).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('win iff roll === betOn; delta ±bet', () => {
    expect(dice(constRng(0.999), 50, 6)).toEqual({ roll: 6, won: true, delta: 50 });
    expect(dice(constRng(0), 50, 6)).toEqual({ roll: 1, won: false, delta: -50 });
    expect(dice(constRng(0), 50, 1)).toEqual({ roll: 1, won: true, delta: 50 });
  });
});

describe('slots', () => {
  it('keeps the old 7 symbols', () => {
    expect(SLOT_SYMBOLS).toEqual(['💝', '🎉', '💎', '💵', '💰', '🚀', '🍿']);
  });

  it('identity shuffles → every row is a triple → jackpot pays +bet', () => {
    const outcome = slots(constRng(0.999), 200);
    expect(outcome.kind).toBe('jackpot');
    expect(outcome.delta).toBe(200);
    const [s1, s2, s3] = outcome.payline;
    expect(s1).toBe(s2);
    expect(s2).toBe(s3);
  });

  it('all-zero rng also lands a jackpot (all reels shuffle identically)', () => {
    const outcome = slots(constRng(0), 200);
    expect(outcome.kind).toBe('jackpot');
    expect(outcome.delta).toBe(200);
  });

  it('pair on the payline pays floor(bet / 2)', () => {
    // Reels 1–2 identity (payline 💰,💰); reel 3 swaps its index-4 symbol
    // to 💝 via a j=0 draw at i=4. See games.ts for the grid construction.
    const rng = seqRng([
      0.999,
      0.999,
      0.999,
      0.999,
      0.999,
      0.999, // reel 1
      0.999,
      0.999,
      0.999,
      0.999,
      0.999,
      0.999, // reel 2
      0.999,
      0.999,
      0.0,
      0.999,
      0.999,
      0.999, // reel 3
    ]);
    const outcome = slots(rng, 101);
    expect(outcome.kind).toBe('pair');
    expect(outcome.delta).toBe(50); // floor(101 / 2)
  });

  it('three distinct payline symbols lose the bet', () => {
    const rng = seqRng([
      0.999,
      0.999,
      0.999,
      0.999,
      0.999,
      0.999, // reel 1 → payline 💰
      0.999,
      0.999,
      0.0,
      0.999,
      0.999,
      0.999, // reel 2 → payline 💝
      0.999,
      0.999,
      0.3,
      0.999,
      0.999,
      0.999, // reel 3 → payline 🎉
    ]);
    const outcome = slots(rng, 100);
    expect(outcome.kind).toBe('lose');
    expect(outcome.delta).toBe(-100);
    expect(new Set(outcome.payline).size).toBe(3);
  });

  it('display shows three rows with the payline in the middle', () => {
    const outcome = slots(constRng(0.999), 10);
    expect(outcome.displayRows).toHaveLength(3);
    expect(outcome.displayRows[1]).toEqual(outcome.payline);
  });
});

describe('rob', () => {
  it('exposes the old constants: 300 s cooldown, $1000 fine', () => {
    expect(ROB_COOLDOWN_MS).toBe(300_000);
    expect(ROB_FINE).toBe(1000);
    expect(MIN_BET).toBe(1);
  });

  it('partial band (< 0.45): steals floor(rng * amount)', () => {
    const outcome = rob(seqRng([0.44, 0.5]), 1000);
    expect(outcome).toEqual({
      kind: 'partial',
      stolen: 500,
      fine: 0,
      robberDelta: 500,
      targetDelta: -500,
    });
  });

  it('partial band rolling a 0 steal degrades to "nothing" (old UI branch)', () => {
    const outcome = rob(seqRng([0.1, 0.0]), 1000);
    expect(outcome.kind).toBe('nothing');
    expect(outcome.stolen).toBe(0);
    expect(outcome.robberDelta).toBe(0);
  });

  it('nothing band [0.45, 0.70): no movement', () => {
    for (const roll of [0.45, 0.6, 0.6999]) {
      const outcome = rob(constRng(roll), 1000);
      expect(outcome.kind).toBe('nothing');
      expect(outcome.robberDelta).toBe(0);
      expect(outcome.targetDelta).toBe(0);
    }
  });

  it('caught band [0.70, 0.95): robber pays the $1000 fine, target untouched', () => {
    for (const roll of [0.7, 0.8, 0.9499]) {
      const outcome = rob(constRng(roll), 1000);
      expect(outcome.kind).toBe('caught');
      expect(outcome.fine).toBe(1000);
      expect(outcome.robberDelta).toBe(-1000);
      expect(outcome.targetDelta).toBe(0);
    }
  });

  it('full band (>= 0.95): steals the whole amount', () => {
    for (const roll of [0.95, 0.999]) {
      const outcome = rob(constRng(roll), 1000);
      expect(outcome.kind).toBe('full');
      expect(outcome.stolen).toBe(1000);
      expect(outcome.robberDelta).toBe(1000);
      expect(outcome.targetDelta).toBe(-1000);
    }
  });
});

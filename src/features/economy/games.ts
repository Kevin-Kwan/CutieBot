/**
 * Pure game logic with an injected RNG — no DB, no Discord.
 *
 * Parity source: the old `economy/fun.js`. The old games never deducted the
 * stake up front; a win credited `+bet` and a loss debited `-bet`, and the
 * win messages announced "you won $ bet + reward" (cosmetic only). The
 * deltas below preserve exactly that math:
 *
 * - coinflip: 50/50 heads/tails → delta ±bet
 * - roulette: randint(0, 1), win on 0 → delta ±bet (the declared
 *   `rouletteOdds = 0.5` constant was unused; the randint IS the 50/50)
 * - dice: uniform roll 1–6, win iff roll === betOn (default 6) → delta ±bet.
 *   The old index math `rdice[randint(0, 6)]` produced `undefined` ~1/7 of
 *   the time (AUDIT §5.22) — an automatic loss on top of the intended 5/6;
 *   the intended uniform roll is implemented here.
 * - slots: 3 reels over 7 symbols; jackpot (all equal) → +bet, any pair →
 *   +floor(bet / 2), otherwise → −bet
 * - rob: see ROB_* constants and the note on `rob()`.
 */

/** rng() returns a value in [0, 1), like Math.random. */
export type Rng = () => number;

/** Inclusive integer in [min, max] — mirrors the old base.js `randint`. */
export function randInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1) + min);
}

/** Minimum bet across all games (old fun.js `minBet`). */
export const MIN_BET = 1;

// ---------------------------------------------------------------- coinflip

export type CoinSide = 'heads' | 'tails';

export interface CoinflipOutcome {
  readonly result: CoinSide;
  readonly won: boolean;
  /** Wallet delta to apply: +bet on a win, −bet on a loss. */
  readonly delta: number;
}

export function coinflip(rng: Rng, bet: number, choice: CoinSide): CoinflipOutcome {
  const result: CoinSide = randInt(rng, 0, 1) === 0 ? 'heads' : 'tails';
  const won = result === choice;
  return { result, won, delta: won ? bet : -bet };
}

// ---------------------------------------------------------------- roulette

export interface RouletteOutcome {
  readonly won: boolean;
  readonly delta: number;
}

export function roulette(rng: Rng, bet: number): RouletteOutcome {
  const won = randInt(rng, 0, 1) === 0;
  return { won, delta: won ? bet : -bet };
}

// -------------------------------------------------------------------- dice

export interface DiceOutcome {
  readonly roll: number;
  readonly won: boolean;
  readonly delta: number;
}

export function dice(rng: Rng, bet: number, betOn: number): DiceOutcome {
  const roll = randInt(rng, 1, 6);
  const won = roll === betOn;
  return { roll, won, delta: won ? bet : -bet };
}

// ------------------------------------------------------------------- slots

export const SLOT_SYMBOLS: readonly string[] = ['💝', '🎉', '💎', '💵', '💰', '🚀', '🍿'];

export type SlotsKind = 'jackpot' | 'pair' | 'lose';

export interface SlotsOutcome {
  readonly kind: SlotsKind;
  /** The three rows the old UI displayed: [above, payline, below]. */
  readonly displayRows: readonly [string, string, string][];
  readonly payline: readonly [string, string, string];
  readonly delta: number;
}

/** Fisher–Yates shuffle driven by the injected RNG (returns a new array). */
export function shuffleWith<T>(rng: Rng, values: readonly T[]): T[] {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}

/**
 * Slots, faithful to the old construction: each reel is an independently
 * shuffled copy of the 7 symbols, the grid is the 7 rows of triples, and
 * the payline is the middle row (index 4 for 7 symbols) with its neighbours
 * displayed. The old shuffle was the biased `sort(() => Math.random() - 0.5)`;
 * Fisher–Yates keeps every position uniform, which is all the payline math
 * ever depended on.
 */
export function slots(rng: Rng, bet: number): SlotsOutcome {
  const reel1 = shuffleWith(rng, SLOT_SYMBOLS);
  const reel2 = shuffleWith(rng, SLOT_SYMBOLS);
  const reel3 = shuffleWith(rng, SLOT_SYMBOLS);
  const total = SLOT_SYMBOLS.length;
  const rows: [string, string, string][] = reel1.map((symbol, i) => [
    symbol,
    reel2[i] as string,
    reel3[i] as string,
  ]);
  const mid = Math.floor((total + 1) / 2); // 4 for 7 symbols, as in the old code
  const payline = rows[mid] as [string, string, string];
  const displayRows = [rows[mid - 1], rows[mid], rows[mid + 1]] as [string, string, string][];

  const [s1, s2, s3] = payline;
  if (s1 === s2 && s2 === s3) {
    return { kind: 'jackpot', displayRows, payline, delta: bet };
  }
  if (s1 === s2 || s2 === s3 || s1 === s3) {
    return { kind: 'pair', displayRows, payline, delta: Math.floor(bet / 2) };
  }
  return { kind: 'lose', displayRows, payline, delta: -bet };
}

// --------------------------------------------------------------------- rob

/** Rob cooldown: 300 s (old fun.js `.setCooldown(300)`). */
export const ROB_COOLDOWN_MS = 300 * 1000;

/** Fine paid by a caught robber: $1000 (old fun.js). */
export const ROB_FINE = 1000;

/**
 * Rob probability bands. The old comments promise 45/25/25/5 — 45% steal a
 * random portion, 25% steal nothing, 25% get caught and pay the fine, 5%
 * steal the full amount — but `randint(0, 100)` with cut-offs at 45/70/90
 * actually yields 46/25/20/10 (AUDIT §5.23). The documented bands are
 * implemented here.
 */
export const ROB_PARTIAL_CHANCE = 0.45;
export const ROB_NOTHING_CHANCE = 0.25;
export const ROB_CAUGHT_CHANCE = 0.25;
// Remaining 0.05: steal the full amount.

export type RobKind = 'partial' | 'nothing' | 'caught' | 'full';

export interface RobOutcome {
  readonly kind: RobKind;
  /** Amount moved from target to robber (0 unless partial/full). */
  readonly stolen: number;
  /** Fine the robber owes when caught (0 otherwise). */
  readonly fine: number;
  readonly robberDelta: number;
  readonly targetDelta: number;
}

export function rob(rng: Rng, amount: number): RobOutcome {
  const bandRoll = rng();
  // The fraction roll is drawn only in the partial band, exactly as
  // the old code drew it — seeded-RNG behavior is unchanged.
  const fractionRoll = bandRoll < ROB_PARTIAL_CHANCE ? rng() : 0;
  return robFromRolls(amount, bandRoll, fractionRoll);
}

/**
 * Rob outcome from PRE-DRAWN rolls (Phase 6, P1-02/P2-01; Phase 6c
 * receipt model; Phase 6e, R3 final mechanism). The service draws the
 * rolls ONCE per robUser call, BEFORE executeIdempotent — never inside
 * the retriable transaction callback — and passes them in, so the repo
 * transaction itself never rolls and every attempt settles with the
 * SAME rolls. Retries are safe twice over: executeIdempotent re-checks
 * the committed receipt inside every transaction attempt BEFORE
 * running the op, so a retry after a commit replays the stored
 * receipt; and a retry after an abort re-runs the op with the
 * original pre-drawn rolls — a rolled outcome can never change
 * between attempts.
 */
export function robFromRolls(amount: number, bandRoll: number, fractionRoll: number): RobOutcome {
  if (bandRoll < ROB_PARTIAL_CHANCE) {
    // Old code: floor(Math.random() * amount) — can be 0, which the old UI
    // reported through its "failed to steal" branch.
    const stolen = Math.floor(fractionRoll * amount);
    if (stolen <= 0) {
      return { kind: 'nothing', stolen: 0, fine: 0, robberDelta: 0, targetDelta: 0 };
    }
    return { kind: 'partial', stolen, fine: 0, robberDelta: stolen, targetDelta: -stolen };
  }
  if (bandRoll < ROB_PARTIAL_CHANCE + ROB_NOTHING_CHANCE) {
    return { kind: 'nothing', stolen: 0, fine: 0, robberDelta: 0, targetDelta: 0 };
  }
  if (bandRoll < ROB_PARTIAL_CHANCE + ROB_NOTHING_CHANCE + ROB_CAUGHT_CHANCE) {
    return { kind: 'caught', stolen: 0, fine: ROB_FINE, robberDelta: -ROB_FINE, targetDelta: 0 };
  }
  return { kind: 'full', stolen: amount, fine: 0, robberDelta: amount, targetDelta: -amount };
}

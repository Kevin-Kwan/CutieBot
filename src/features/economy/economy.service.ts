import type { ClientSession } from 'mongodb';
import type { AppContext } from '../../core/context.js';
import { isValidAmount, parseAmount } from './amounts.js';
import {
  EconomyError,
  EconomyRepo,
  InsufficientFundsError,
  InvalidAmountError,
  RobCooldownError,
  SelfTransferError,
  type IdempotencyKey,
} from './economy.repo.js';

export { RobCooldownError };
import {
  MIN_BET,
  ROB_PARTIAL_CHANCE,
  coinflip,
  dice,
  randInt,
  roulette,
  slots,
  type CoinSide,
  type CoinflipOutcome,
  type DiceOutcome,
  type RobOutcome,
  type RouletteOutcome,
  type Rng,
  type SlotsOutcome,
} from './games.js';
import { SHOP_ITEMS, buyPrice, findItem, sellPrice, type ShopItem } from './shop.js';
import { REWARDS, type EconomyUser, type RewardKind } from './types.js';

/** A Discord user as the economy layer needs to see it. */
export interface EconomyActor {
  readonly id: string;
  readonly bot: boolean;
}

export type ClaimOutcome =
  | { readonly status: 'claimed'; readonly amount: number; readonly user: EconomyUser }
  | { readonly status: 'cooldown'; readonly nextAvailableAt: number };

export interface BetOutcome<T> {
  readonly outcome: T;
  readonly bet: number;
  readonly user: EconomyUser;
}

export interface RobResult {
  readonly outcome: RobOutcome;
  /** The fine actually taken (clamped to the robber's transactional wallet). */
  readonly fineApplied: number;
  readonly robber: EconomyUser;
  readonly target: EconomyUser;
}

export interface PayReceipt {
  readonly amount: number;
  readonly fromUser: EconomyUser;
  readonly toUser: EconomyUser;
}

export interface MoveReceipt {
  readonly amount: number;
  readonly user: EconomyUser;
}

export interface BuyReceipt {
  readonly item: ShopItem;
  readonly user: EconomyUser;
}

export interface SellReceipt {
  readonly item: ShopItem;
  readonly price: number;
  readonly user: EconomyUser;
}

/**
 * Build the repo idempotency key for one interaction-driven mutation.
 * Phase 6c (R3): the key binds the operation's PARAMETERS — a replay
 * is only a replay when kind, actor, and params all match.
 */
function idemKey(
  interactionId: string | undefined,
  kind: string,
  actorId: string,
  params?: unknown,
): IdempotencyKey | undefined {
  return interactionId === undefined
    ? undefined
    : { id: interactionId, kind, actorId, ...(params !== undefined ? { params } : {}) };
}

/**
 * Economy orchestration used by the commands: input parsing, actor
 * validation (no bot accounts, no self-transfers — the predicates are the
 * caller's Discord user objects), game resolution, and delegation to the
 * repository for every mutation. All expected failures are EconomyError
 * subclasses with user-facing messages; commands render them as error
 * embeds and let anything else reach the router.
 *
 * Phase 6c (R3) — end-to-end idempotency receipts: the Phase 6 ledger
 * stored only the REPO-level result, and this layer validated funds and
 * rolled game RNG BEFORE the repo ever saw the key, so a replayed
 * interaction could fail validation against post-commit state (a
 * full-wallet /pay replay reporting insufficient funds) or display a
 * freshly-rolled game outcome that never settled. Now every mutating
 * method (1) checks the ledger for a committed receipt BEFORE any
 * state-dependent validation or RNG, and (2) executes through
 * repo.executeIdempotent with an op that builds the COMPLETE receipt —
 * actual amount moved, game outcome/delta, resulting balances — from
 * the in-transaction core, so the stored receipt is exactly what the
 * first delivery returned and exactly what any replay returns.
 * Stateless validation (bot/self checks, catalog lookups, amount
 * syntax that needs no balance) still runs first; everything that
 * reads current balances happens inside the op. The actor's account
 * is still created OUTSIDE the transaction (Phase 6 behavior: a
 * failed validation leaves the freshly created account in place,
 * while a failed PURCHASE aborts atomically at the repo layer) —
 * but only after the receipt check, so a replay touches nothing.
 */
export class EconomyService {
  private readonly rng: Rng;

  constructor(
    private readonly repo: EconomyRepo,
    rng: Rng = Math.random,
  ) {
    this.rng = rng;
  }

  /** The committed receipt for `idem`, or null when uncommitted. */
  private async storedReceipt<T>(idem: IdempotencyKey | undefined): Promise<T | null> {
    if (idem === undefined) return null;
    const stored = await this.repo.findReceipt(idem);
    return stored === null ? null : (stored as T);
  }

  getOrCreate(userId: string): Promise<EconomyUser> {
    return this.repo.ensureUser(userId);
  }

  /** Balance view: bots never have accounts (the old balance command agreed). */
  async balanceOf(actor: EconomyActor): Promise<EconomyUser> {
    if (actor.bot) throw new EconomyError("Bots don't have an account.");
    return this.repo.ensureUser(actor.id);
  }

  async pay(
    from: EconomyActor,
    to: EconomyActor,
    rawAmount: string,
    interactionId?: string,
  ): Promise<PayReceipt> {
    if (to.bot) throw new EconomyError("Bots don't have an account.");
    if (from.id === to.id) throw new SelfTransferError("You can't pay yourself.");
    const idem = idemKey(interactionId, 'pay', from.id, { toId: to.id, rawAmount });
    const stored = await this.storedReceipt<PayReceipt>(idem);
    if (stored !== null) return stored;
    await this.repo.ensureUser(from.id);
    return this.repo.executeIdempotent(idem, async (session) => {
      const sender = await this.repo.ensureUser(from.id, session);
      const parsed = parseAmount(rawAmount, sender.wallet);
      if (!parsed.ok) throw new EconomyError(parsed.error);
      if (parsed.amount > sender.wallet) {
        throw new InsufficientFundsError(
          `You don't have enough money to pay that much! You currently have ${sender.wallet}.`,
        );
      }
      const { from: fromUser, to: toUser } = await this.repo.transferInTxn(
        session,
        from.id,
        to.id,
        parsed.amount,
      );
      return { amount: parsed.amount, fromUser, toUser };
    });
  }

  async deposit(userId: string, rawAmount: string, interactionId?: string): Promise<MoveReceipt> {
    const idem = idemKey(interactionId, 'deposit', userId, { rawAmount });
    const stored = await this.storedReceipt<MoveReceipt>(idem);
    if (stored !== null) return stored;
    await this.repo.ensureUser(userId);
    return this.repo.executeIdempotent(idem, async (session) => {
      const account = await this.repo.ensureUser(userId, session);
      const parsed = parseAmount(rawAmount, account.wallet);
      if (!parsed.ok) throw new EconomyError(parsed.error);
      if (parsed.amount > account.wallet) {
        throw new InsufficientFundsError(
          `You don't have enough money! You have ${account.wallet} in your wallet.`,
        );
      }
      const user = await this.repo.moveFundsInTxn(session, userId, 'wallet', parsed.amount);
      return { amount: parsed.amount, user };
    });
  }

  async withdraw(userId: string, rawAmount: string, interactionId?: string): Promise<MoveReceipt> {
    const idem = idemKey(interactionId, 'withdraw', userId, { rawAmount });
    const stored = await this.storedReceipt<MoveReceipt>(idem);
    if (stored !== null) return stored;
    await this.repo.ensureUser(userId);
    return this.repo.executeIdempotent(idem, async (session) => {
      const account = await this.repo.ensureUser(userId, session);
      const parsed = parseAmount(rawAmount, account.bank);
      if (!parsed.ok) throw new EconomyError(parsed.error);
      if (parsed.amount > account.bank) {
        throw new InsufficientFundsError(
          `You don't have enough money! You have ${account.bank} in your bank.`,
        );
      }
      const user = await this.repo.moveFundsInTxn(session, userId, 'bank', parsed.amount);
      return { amount: parsed.amount, user };
    });
  }

  /** Claim a timed reward; the amount is rolled here, the claim itself is atomic in the repo. */
  async claim(userId: string, kind: RewardKind): Promise<ClaimOutcome> {
    const def = REWARDS[kind];
    const amount = randInt(this.rng, def.min, def.max);
    const result = await this.repo.claimReward(userId, kind, amount);
    if (!result.claimed) {
      return { status: 'cooldown', nextAvailableAt: result.nextAvailableAt };
    }
    const user = await this.repo.ensureUser(userId);
    return { status: 'claimed', amount: result.amount, user };
  }

  /** Parse + validate a game bet against the user's IN-TRANSACTION wallet. */
  private async parseBet(
    userId: string,
    rawAmount: string,
    session: ClientSession,
  ): Promise<{ bet: number; account: EconomyUser }> {
    const account = await this.repo.ensureUser(userId, session);
    const parsed = parseAmount(rawAmount, account.wallet);
    if (!parsed.ok) throw new EconomyError(parsed.error);
    if (parsed.amount > account.wallet) {
      throw new EconomyError(
        `You don't have enough money to bet that much! You currently have ${account.wallet}.`,
      );
    }
    if (parsed.amount < MIN_BET) {
      throw new EconomyError(`You need to bet at least ${MIN_BET}.`);
    }
    return { bet: parsed.amount, account };
  }

  /**
   * Play one game end-to-end (Phase 6c, R3): receipt check first, then
   * — inside the idempotent transaction — bet parsing, ONE RNG roll,
   * and the repo's atomic conditional settlement (Phase 6, P1-02: the
   * filter requires stake coverage for both signs in a single guarded
   * update, so concurrent drains cannot overdraw or double-pay). The
   * receipt stores the rolled outcome itself, so a replay displays the
   * outcome that actually settled, never a reroll. Game deltas are
   * bounded by the stake by construction (see games.ts).
   */
  private async playGame<T>(
    userId: string,
    rawAmount: string,
    interactionId: string | undefined,
    kind: string,
    params: unknown,
    roll: (bet: number, rng: () => number) => { outcome: T; delta: number },
  ): Promise<BetOutcome<T>> {
    const idem = idemKey(interactionId, kind, userId, params);
    const stored = await this.storedReceipt<BetOutcome<T>>(idem);
    if (stored !== null) return stored;
    await this.repo.ensureUser(userId);
    // Phase 6e (R3): the RNG draws live OUTSIDE the retriable
    // transaction callback. executeIdempotent may run the op more
    // than once (a transient commit failure retries it), and drawing
    // inside the op would settle the retry with a DIFFERENT outcome
    // than the first attempt rolled. Instead, every draw the op makes
    // is recorded in `draws`; each attempt replays the recorded draws
    // from the top via a fresh cursor, consulting the real RNG only
    // for draws no attempt has made yet. The op validates the stake
    // against the transactional balance and settles with the drawn
    // outcome; if that validation fails the op throws, nothing
    // commits, and the draws are discarded with the failed
    // interaction — which is correct, as no outcome was ever settled.
    const draws: number[] = [];
    return this.repo.executeIdempotent(idem, async (session) => {
      const { bet } = await this.parseBet(userId, rawAmount, session);
      let cursor = 0;
      const replayRng = (): number => {
        if (cursor < draws.length) {
          const recorded = draws[cursor] as number;
          cursor += 1;
          return recorded;
        }
        const value = this.rng();
        draws.push(value);
        cursor += 1;
        return value;
      };
      const { outcome, delta } = roll(bet, replayRng);
      const user = await this.repo.settleBetInTxn(session, userId, bet, delta);
      return { outcome, bet, user };
    });
  }

  async playCoinflip(
    userId: string,
    rawAmount: string,
    choice: CoinSide,
    interactionId?: string,
  ): Promise<BetOutcome<CoinflipOutcome>> {
    return this.playGame(
      userId,
      rawAmount,
      interactionId,
      'coinflip',
      { rawAmount, choice },
      (bet, rng) => {
        const outcome = coinflip(rng, bet, choice);
        return { outcome, delta: outcome.delta };
      },
    );
  }

  async playRoulette(
    userId: string,
    rawAmount: string,
    interactionId?: string,
  ): Promise<BetOutcome<RouletteOutcome>> {
    return this.playGame(userId, rawAmount, interactionId, 'roulette', { rawAmount }, (bet, rng) => {
      const outcome = roulette(rng, bet);
      return { outcome, delta: outcome.delta };
    });
  }

  async playDice(
    userId: string,
    rawAmount: string,
    betOn: number,
    interactionId?: string,
  ): Promise<BetOutcome<DiceOutcome>> {
    return this.playGame(userId, rawAmount, interactionId, 'dice', { rawAmount, betOn }, (bet, rng) => {
      const outcome = dice(rng, bet, betOn);
      return { outcome, delta: outcome.delta };
    });
  }

  async playSlots(
    userId: string,
    rawAmount: string,
    interactionId?: string,
  ): Promise<BetOutcome<SlotsOutcome>> {
    return this.playGame(userId, rawAmount, interactionId, 'slots', { rawAmount }, (bet, rng) => {
      const outcome = slots(rng, bet);
      return { outcome, delta: outcome.delta };
    });
  }

  /**
   * Attempt a robbery. Amounts parse against the TARGET's wallet, as
   * in the old command. Everything else — cooldown check + stamp,
   * settlement, fine clamping — happens inside ONE repo transaction
   * (Phase 6, P2-01/G2): the Phase 2 shape stamped the cooldown in a
   * separate operation BEFORE settlement (an infrastructure failure
   * burned the cooldown for nothing) and clamped the fine against a
   * stale snapshot (a concurrent deposit could evade it). The RNG
   * rolls are drawn once, BEFORE the idempotent op (Phase 6e, R3 —
   * never inside the retriable callback), and the receipt stores the
   * committed outcome (Phase 6c, R3).
   */
  async robUser(
    robberActor: EconomyActor,
    target: EconomyActor,
    rawAmount: string,
    interactionId?: string,
  ): Promise<RobResult> {
    if (target.bot) throw new EconomyError("Bots don't have an account.");
    if (robberActor.id === target.id) throw new EconomyError("You can't rob yourself.");
    const idem = idemKey(interactionId, 'rob', robberActor.id, {
      targetId: target.id,
      rawAmount,
    });
    const stored = await this.storedReceipt<RobResult>(idem);
    if (stored !== null) return stored;
    // Phase 6e (R3): draw the band/fraction ONCE, here — before the
    // retriable transaction callback. Drawing inside the op (the
    // Phase 6c shape) meant a transient commit retry re-rolled and
    // could settle a different outcome than the first attempt's.
    // If the op's transactional validation fails, the draws are
    // discarded with the failed interaction; nothing committed.
    const band = this.rng();
    const fraction = band < ROB_PARTIAL_CHANCE ? this.rng() : 0;
    await this.repo.ensureUser(target.id);
    return this.repo.executeIdempotent(idem, async (session) => {
      const targetAccount = await this.repo.ensureUser(target.id, session);
      const parsed = parseAmount(rawAmount, targetAccount.wallet);
      if (!parsed.ok) throw new EconomyError(parsed.error);
      if (parsed.amount > targetAccount.wallet) {
        throw new EconomyError(
          `The target doesn't have enough money to steal that much! They currently have ${targetAccount.wallet}.`,
        );
      }
      if (parsed.amount < MIN_BET) {
        throw new EconomyError(`You need to steal at least ${MIN_BET}.`);
      }
      const {
        outcome,
        fineApplied,
        robber,
        target: targetAfter,
      } = await this.repo.robInTxn(
        session,
        robberActor.id,
        target.id,
        parsed.amount,
        { band, fraction },
        Date.now(),
      );
      return { outcome, fineApplied, robber, target: targetAfter };
    });
  }

  async buy(userId: string, query: string, interactionId?: string): Promise<BuyReceipt> {
    const item = findItem(query);
    if (item === undefined) {
      throw new EconomyError(`There's no item named \`${query.trim().toLowerCase()}\`.`);
    }
    const idem = idemKey(interactionId, 'buy', userId, { itemId: item.id });
    const stored = await this.storedReceipt<BuyReceipt>(idem);
    if (stored !== null) return stored;
    await this.repo.ensureUser(userId);
    return this.repo.executeIdempotent(idem, async (session) => {
      const account = await this.repo.ensureUser(userId, session);
      if (account.wallet < buyPrice(item)) {
        throw new InsufficientFundsError(`You don't have enough money to buy ${item.name}.`);
      }
      const user = await this.repo.purchaseInTxn(session, userId, item, 1);
      return { item, user };
    });
  }

  async sell(userId: string, query: string, interactionId?: string): Promise<SellReceipt> {
    const item = findItem(query);
    if (item === undefined) {
      throw new EconomyError(`There's no item named \`${query.trim().toLowerCase()}\`.`);
    }
    const idem = idemKey(interactionId, 'sell', userId, { itemId: item.id });
    const stored = await this.storedReceipt<SellReceipt>(idem);
    if (stored !== null) return stored;
    return this.repo.executeIdempotent(idem, async (session) => {
      const user = await this.repo.sellBackInTxn(session, userId, item);
      return { item, price: sellPrice(item), user };
    });
  }

  async inventoryOf(actor: EconomyActor): Promise<EconomyUser> {
    if (actor.bot) throw new EconomyError("Bots don't have an account.");
    return this.repo.ensureUser(actor.id);
  }

  /**
   * Owner-only mint (addmoney). Amount is validated at this boundary.
   * Phase 6c (R3): goes through the ledger with the interaction ID —
   * the Phase 6 version took no key at all, so a redelivered
   * /addmoney minted twice. Phase 6e (R3): the ledger's actorId is
   * the INVOKING OWNER (who performed the admin action), not the
   * target — the target is bound in params. (Phase 6c bound the
   * target as the actor, which made the audit record useless: it
   * could not say WHO minted.) `actorId` is optional only so
   * non-command callers keep compiling; the commands always pass it.
   */
  async adminAdd(
    target: EconomyActor,
    amount: number,
    interactionId?: string,
    actorId?: string,
  ): Promise<EconomyUser> {
    if (target.bot) throw new EconomyError("Bots don't have an account.");
    if (!isValidAmount(amount)) throw new InvalidAmountError();
    const idem = idemKey(interactionId, 'adminAdd', actorId ?? target.id, {
      targetId: target.id,
      amount,
    });
    const stored = await this.storedReceipt<EconomyUser>(idem);
    if (stored !== null) return stored;
    await this.repo.ensureUser(target.id);
    return this.repo.executeIdempotent(idem, async (session) => {
      await this.repo.ensureUser(target.id, session);
      await this.repo.credit(target.id, 'wallet', amount, session);
      return this.repo.ensureUser(target.id, session);
    });
  }

  /**
   * Owner-only removal (removemoney). The old command debited with a bare
   * $inc and could drive the target negative; v3 refuses amounts above the
   * wallet instead. Phase 6c (R3): ledger-backed like adminAdd; the
   * funds check runs inside the op, after the receipt check.
   */
  async adminRemove(
    target: EconomyActor,
    amount: number,
    interactionId?: string,
    actorId?: string,
  ): Promise<EconomyUser> {
    if (target.bot) throw new EconomyError("Bots don't have an account.");
    // Phase 6 (P3): validate at the service boundary — a negative
    // amount reaching adjustWallet would flip sign and CREDIT the
    // target. The slash option's min-value is not a boundary.
    if (!isValidAmount(amount)) throw new InvalidAmountError();
    // Phase 6e (R3): actor binding as in adminAdd — the invoking
    // owner is the actor; the target is bound in params.
    const idem = idemKey(interactionId, 'adminRemove', actorId ?? target.id, {
      targetId: target.id,
      amount,
    });
    const stored = await this.storedReceipt<EconomyUser>(idem);
    if (stored !== null) return stored;
    await this.repo.ensureUser(target.id);
    return this.repo.executeIdempotent(idem, async (session) => {
      const account = await this.repo.ensureUser(target.id, session);
      if (amount > account.wallet) {
        throw new InsufficientFundsError(`They only have ${account.wallet} in their wallet.`);
      }
      await this.repo.adjustWallet(target.id, -amount, session);
      return this.repo.ensureUser(target.id, session);
    });
  }

  leaderboard(limit = 10) {
    return this.repo.leaderboard(limit);
  }

  shopCatalog(): readonly ShopItem[] {
    return SHOP_ITEMS;
  }
}

/** Build the economy service for a command invocation from the app context. */
export function economyFromContext(ctx: AppContext): EconomyService {
  return new EconomyService(new EconomyRepo(ctx.db, ctx.logger));
}

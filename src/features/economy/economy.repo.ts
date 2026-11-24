import type { ClientSession, Collection, Document, WithId } from 'mongodb';
import type { DbHandles } from '../../core/context.js';
import { TrustedMessageError } from '../../core/errors.js';
import type { AppLogger } from '../../core/logger.js';
import { isValidAmount } from './amounts.js';
import { ROB_COOLDOWN_MS, robFromRolls, type RobOutcome } from './games.js';
import { buyPrice, sellPrice, type ShopItem } from './shop.js';
import {
  ECONOMY_COLLECTION,
  REWARDS,
  emptyUser,
  normalizeEconomyUser,
  toDocument,
  type EconomyUser,
  type RewardKind,
} from './types.js';

/**
 * Base class for errors whose message is safe to show to the user.
 * Extends TrustedMessageError (Phase 6e, R7): economy messages are
 * built from safe parts (amounts, item names), so the log serializer
 * may keep them; every subclass inherits the trust.
 */
export class EconomyError extends TrustedMessageError {}

export class InvalidAmountError extends EconomyError {
  constructor(message = 'Enter a valid amount.') {
    super(message);
  }
}

export class SelfTransferError extends EconomyError {
  constructor(message = "You can't transfer money to yourself.") {
    super(message);
  }
}

export class InsufficientFundsError extends EconomyError {
  constructor(message = "You don't have enough money for that.") {
    super(message);
  }
}

export class NotOwnedError extends EconomyError {
  constructor(message = "You don't own that item.") {
    super(message);
  }
}

/**
 * A balance is at the safe-integer ceiling (Phase 6, AUDIT6 P0-02):
 * the operation would push it past Number.MAX_SAFE_INTEGER, past
 * which integer money math silently loses precision. The operation
 * is refused (and any surrounding transaction aborts) instead.
 */
export class BalanceOverflowError extends EconomyError {
  constructor(field: 'wallet' | 'bank') {
    super(`That ${field} balance is too large to add to.`);
  }
}

/**
 * An inventory increment would push a quantity past the safe-integer
 * ceiling (Phase 6c, R2). Refused like a balance overflow — never
 * clamped, never wrapped.
 */
export class InventoryOverflowError extends EconomyError {
  constructor() {
    super('That item quantity is too large to add to.');
  }
}

/**
 * The account's stored record failed normalization and is QUARANTINED
 * (Phase 6c, R1): the account is FROZEN — no financial mutation may
 * proceed — until an operator resolves the quarantine via
 * EconomyRepo.resolveQuarantine. (Phase 6 archived the record but let
 * a fresh starting-balance account be created over it, silently
 * orphaning the real balance; GPT re-audit P0-01.)
 */
export class QuarantinedAccountError extends EconomyError {
  constructor(userId: string) {
    super(
      `Account ${userId} is frozen: its stored record was invalid and has been quarantined. ` +
        'No money can move until an operator reviews and resolves the quarantined record.',
    );
  }
}

/**
 * INTERNAL control-flow signal (Phase 6e, R1) — never surfaces to
 * callers. Thrown by the in-transaction loader when a stored record
 * fails normalization, carrying the invalid snapshot out of the
 * transaction. Persisting the quarantine INSIDE the discovering
 * transaction was the Phase 6c durability bug GPT's re-review found:
 * the financial operation aborts on the freeze error, and the abort
 * rolls the quarantine event (and the invalid record's removal) back
 * with it — the corruption is then rediscovered forever and the
 * freeze evidence never lands. The repo boundary catches this signal
 * OUTSIDE the doomed transaction, persists the quarantine in its own
 * transaction (see persistQuarantine), and only then surfaces
 * QuarantinedAccountError. Read/repair and operator-resolution paths,
 * whose transactions are NOT doomed, catch it and quarantine inline.
 */
class QuarantineDiscoveredError extends Error {
  constructor(
    readonly userId: string,
    readonly original: WithId<EconomyDoc>,
    readonly issues: readonly string[],
  ) {
    super(`economy record for ${userId} failed normalization inside a transaction`);
    this.name = 'QuarantineDiscoveredError';
  }
}

/**
 * An idempotency key was replayed with DIFFERENT operation parameters
 * than the ones it committed with (Phase 6c, R3): the stored receipt
 * belongs to another operation, so neither replaying it nor executing
 * the new operation under the same key is safe.
 */
export class IdempotencyConflictError extends EconomyError {
  constructor() {
    super('That interaction was already used for a different operation.');
  }
}

/** Thrown when a rob attempt is still on cooldown; carries the unlock time. */
export class RobCooldownError extends EconomyError {
  readonly nextAvailableAt: number;

  constructor(nextAvailableAt: number) {
    super('You need to wait before robbing again.');
    this.nextAvailableAt = nextAvailableAt;
  }
}

export interface ClaimResult {
  readonly claimed: boolean;
  /** Amount credited (0 when the claim was refused). */
  readonly amount: number;
  /** Epoch ms when the reward next becomes available. */
  readonly nextAvailableAt: number;
}

export interface LeaderboardEntry {
  readonly userId: string;
  readonly wallet: number;
  readonly bank: number;
  /**
   * Exact net worth (Phase 6c, R2): a bigint — wallet + bank can each
   * be MAX_SAFE_INTEGER, whose sum no double represents exactly.
   */
  readonly net: bigint;
}

export interface RobTxResult {
  readonly outcome: RobOutcome;
  /** The fine actually taken (clamped to the robber's transactional wallet). */
  readonly fineApplied: number;
  readonly robber: EconomyUser;
  readonly target: EconomyUser;
}

/**
 * Durable idempotency key for one interaction-driven mutation
 * (Phase 6, AUDIT6 P1-01 / G3). Discord can deliver the same
 * interaction more than once; the first delivery inserts a ledger
 * record INSIDE the mutation's transaction, and any replay returns
 * the stored result instead of moving money twice.
 *
 * Phase 6c (R3): the key also carries the operation's PARAMETERS.
 * The ledger stores them alongside the complete receipt, and a replay
 * whose kind/actor/params do not match the stored binding is a
 * conflict, not a receipt — the same interaction id can never be
 * silently rebound to a different operation.
 */
export interface IdempotencyKey {
  /** The Discord interaction id. */
  readonly id: string;
  readonly kind: string;
  readonly actorId: string;
  /** Operation parameters the receipt is bound to (JSON-shaped). */
  readonly params?: unknown;
}

export const ECONOMY_IDEMPOTENCY_COLLECTION = 'economy_idempotency';
export const ECONOMY_QUARANTINE_COLLECTION = 'economy_quarantine';

interface IdempotencyDoc {
  _id: string;
  kind: string;
  actorId: string;
  params?: unknown;
  result: unknown;
  createdAt: Date;
}

/**
 * One quarantine EVENT (Phase 6c, R1): append-only — every record that
 * fails normalization appends a new event; events are never keyed by
 * the record's _id and never overwritten. An account with an
 * UNRESOLVED event (resolvedAt === null) is frozen. Resolution is an
 * operator action (resolveQuarantine) that stamps every open event.
 */
interface QuarantineEventDoc {
  _id?: unknown;
  userId: string;
  original: Document;
  issues: string[];
  attemptedUserId: string;
  quarantinedAt: Date;
  resolvedAt: Date | null;
  resolution: string | null;
}

interface SessionOpts {
  readonly session?: ClientSession;
}

/**
 * The stored document shape. Reads are never trusted — everything passes
 * through normalizeEconomyUser (which takes `unknown`) — but writes always
 * produce this shape. Legacy documents may carry extra fields at runtime;
 * they are simply outside this type.
 */
interface EconomyDoc {
  _id: string;
  userId: string;
  wallet: number;
  bank: number;
  inventory: { itemId: number; qty: number }[];
  lastDaily: number | null;
  lastWeekly: number | null;
  lastMonthly: number | null;
  lastRobbed: number | null;
}

function sessionOpts(session?: ClientSession): SessionOpts {
  return session === undefined ? {} : { session };
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

/**
 * Economy repository (PLAN §6) — the only module that talks to Mongo for
 * economy data. Replaces the old `bank_funcs`/`inventory_funcs` pair, whose
 * reads were positional Object.values() lookups, whose account creation was
 * an un-awaited insert, and whose transfers were two unguarded $inc calls
 * (AUDIT §5.18–5.21).
 *
 * Invariants enforced here:
 * - one canonical account identity: `_id` === `userId` (Phase 6, P2-04);
 * - every stored document passes through normalizeEconomyUser on read;
 *   records that cannot be normalized are QUARANTINED verbatim
 *   (original preserved as an append-only event in
 *   `economy_quarantine`, diagnostics logged), never silently reset
 *   (P0-01) — and the account stays FROZEN, mutations refused with
 *   QuarantinedAccountError, until an operator resolves the event
 *   (Phase 6c, R1);
 * - repairs are written inside a transaction from a fresh snapshot, so
 *   a stale repair can never overwrite a concurrent balance change
 *   (P0-01 — the Phase 2 persistRepair wrote with a bare `{ _id }`
 *   filter and no concurrency guard);
 * - credits are guarded so no balance can pass the safe-integer
 *   ceiling (P0-02);
 * - multi-step mutations run in a transaction with the balance guard
 *   INSIDE it, and return the transactional snapshots directly — no
 *   post-commit re-read can misreport a committed operation (P2-02);
 * - interaction-driven mutations carry a durable idempotency ledger
 *   record in the same transaction (P1-01);
 * - reward claims are a single conditional update, so two simultaneous
 *   claims cannot both succeed;
 * - balances never go negative through this layer.
 */
export class EconomyRepo {
  private readonly logger: AppLogger | undefined;

  constructor(
    private readonly handles: DbHandles,
    logger?: AppLogger,
  ) {
    this.logger = logger;
  }

  private collection(): Collection<EconomyDoc> {
    return this.handles.db.collection<EconomyDoc>(ECONOMY_COLLECTION);
  }

  private idempotencyCollection(): Collection<IdempotencyDoc> {
    return this.handles.db.collection<IdempotencyDoc>(ECONOMY_IDEMPOTENCY_COLLECTION);
  }

  private quarantineCollection(): Collection<QuarantineEventDoc> {
    return this.handles.db.collection<QuarantineEventDoc>(ECONOMY_QUARANTINE_COLLECTION);
  }

  // ------------------------------------------------------------ reads

  /**
   * Read a user by canonical id. Returns null when no (valid) document
   * exists. Legacy documents are repaired — and invalid ones
   * quarantined — inside a transaction before being returned.
   */
  async getUser(userId: string): Promise<EconomyUser | null> {
    return this.loadUser(userId);
  }

  private async loadUser(userId: string, session?: ClientSession): Promise<EconomyUser | null> {
    if (session !== undefined) return this.loadUserInTxn(userId, session);
    const raw = await this.collection().findOne({ $or: [{ userId }, { _id: userId }] });
    if (raw === null) return null;
    const norm = normalizeEconomyUser(raw);
    if (norm.ok && !this.needsRepair(raw, norm.user)) return norm.user;
    // Repair or quarantine — inside a transaction, from a fresh read.
    // This read/repair transaction is not a financial operation, so a
    // discovery is quarantined INLINE here (Phase 6e, R1): the
    // transaction commits the quarantine normally.
    const repairSession = this.handles.client.startSession();
    try {
      let result: EconomyUser | null = null;
      await repairSession.withTransaction(async () => {
        try {
          result = await this.loadUserInTxn(userId, repairSession);
        } catch (error) {
          if (error instanceof QuarantineDiscoveredError) {
            await this.quarantine(error.original, error.issues, error.userId, repairSession);
            result = null;
            return;
          }
          throw error;
        }
      });
      return result;
    } finally {
      await repairSession.endSession();
    }
  }

  private async loadUserInTxn(userId: string, session: ClientSession): Promise<EconomyUser | null> {
    const raw = await this.collection().findOne(
      { $or: [{ userId }, { _id: userId }] },
      { session },
    );
    if (raw === null) return null;
    const norm = normalizeEconomyUser(raw);
    if (!norm.ok) {
      // Phase 6e (R1): do NOT quarantine inline here. This loader runs
      // inside financial transactions, which ABORT when the caller
      // surfaces the freeze — and the abort would roll the quarantine
      // event back with the operation, losing the freeze evidence.
      // Signal the discovery out; the repo boundary persists it in
      // its own transaction (persistQuarantine).
      throw new QuarantineDiscoveredError(userId, raw, norm.issues);
    }
    if (this.needsRepair(raw, norm.user)) {
      await this.writeRepair(norm.user, raw, session);
    }
    return norm.user;
  }

  /**
   * Persist a quarantine discovery in its OWN transaction (Phase 6e,
   * R1) — called by the repo boundary AFTER the financial transaction
   * that discovered the corruption has aborted, so the event (and the
   * invalid record's removal) commits independently of the doomed
   * operation. No portion of the failed financial operation commits:
   * its transaction is already gone when this runs.
   *
   * Phase 6g (R1): the persistence must NOT trust the snapshot the
   * aborted transaction captured. GPT's final confirmation found the
   * stale-document race: this persistence can be delayed past another
   * flow's quarantine AND an operator's resolveQuarantine restore —
   * archiving the stale snapshot and deleting by its _id then removes
   * the operator's CORRECTED account. So the transaction here REREADS
   * the live record and re-validates it: only a record that still
   * exists AND still fails normalization is archived (the CURRENT
   * document, with its fresh issue list) and removed. An absent
   * record (already quarantined elsewhere), a repaired record, or an
   * account another flow has already frozen (an unresolved event
   * exists) makes this persistence a no-op — it adds no duplicate
   * event and deletes nothing. The caller still surfaces
   * QuarantinedAccountError either way: the financial operation was
   * correctly aborted on the discovery.
   */
  private async persistQuarantine(discovery: QuarantineDiscoveredError): Promise<void> {
    const session = this.handles.client.startSession();
    try {
      await session.withTransaction(async () => {
        // Another flow already froze this account: its event is the
        // durable record of the corruption — add nothing.
        if (await this.hasUnresolvedQuarantine(discovery.userId, session)) return;
        const current = await this.collection().findOne(
          { $or: [{ userId: discovery.userId }, { _id: discovery.userId }] },
          { session },
        );
        // Absent: already quarantined/removed by the other flow.
        if (current === null) return;
        const norm = normalizeEconomyUser(current);
        // Repaired or restored since the discovery: the live record
        // is valid now — archiving or deleting it would destroy a
        // good account on a stale snapshot.
        if (norm.ok) return;
        await this.quarantine(current, norm.issues, discovery.userId, session);
      });
    } finally {
      await session.endSession();
    }
  }

  /**
   * Whether the stored document differs from the canonical shape of
   * its normalized form (Phase 6, P2-03): repair necessity is decided
   * by FIELD DIFFS, not by whether normalization happened to record an
   * issue — a BSON Date timestamp, for instance, differs from the
   * canonical epoch-ms number whether or not an issue was logged.
   */
  private needsRepair(raw: WithId<EconomyDoc>, user: EconomyUser): boolean {
    const clean = toDocument(user);
    const rawRecord = raw as Record<string, unknown>;
    for (const key of [
      'userId',
      'wallet',
      'bank',
      'inventory',
      'lastDaily',
      'lastWeekly',
      'lastMonthly',
      'lastRobbed',
    ]) {
      if (JSON.stringify(rawRecord[key]) !== JSON.stringify(clean[key])) return true;
    }
    for (const itemName of ['watch', 'mobile', 'laptop']) {
      if (itemName in rawRecord) return true;
    }
    // Identity: the stored _id must BE the canonical id (string form).
    if (typeof raw._id !== 'string' || raw._id !== user.userId) return true;
    return false;
  }

  /**
   * Write the canonical shape back, INSIDE the caller's transaction
   * (P0-01). The transaction's fresh snapshot + write set mean a
   * concurrent committed balance change is either seen by the repair
   * (and preserved — normalization only rewrites fields whose stored
   * values are non-canonical, and balances are only rewritten when
   * they needed coercion) or aborts the repair with a write conflict,
   * which retries from the newer snapshot.
   */
  private async writeRepair(
    user: EconomyUser,
    raw: WithId<EconomyDoc>,
    session: ClientSession,
  ): Promise<void> {
    const clean = toDocument(user);
    if (typeof raw._id !== 'string' || raw._id !== user.userId) {
      // _id is immutable: a legacy doc keyed by a non-string or foreign
      // _id is replaced wholesale (delete + insert) in this transaction.
      await this.collection().deleteOne({ _id: raw._id }, { session });
      await this.collection().insertOne(clean as unknown as EconomyDoc, { session });
      return;
    }
    const rawRecord = raw as Record<string, unknown>;
    const set: Record<string, unknown> = {};
    for (const key of [
      'userId',
      'wallet',
      'bank',
      'inventory',
      'lastDaily',
      'lastWeekly',
      'lastMonthly',
      'lastRobbed',
    ]) {
      if (JSON.stringify(rawRecord[key]) !== JSON.stringify(clean[key])) {
        set[key] = clean[key];
      }
    }
    const unset: Record<string, string> = {};
    for (const itemName of ['watch', 'mobile', 'laptop']) {
      if (itemName in rawRecord) unset[itemName] = '';
    }
    if (Object.keys(set).length === 0 && Object.keys(unset).length === 0) return;
    const update: Document = {};
    if (Object.keys(set).length > 0) update['$set'] = set;
    if (Object.keys(unset).length > 0) update['$unset'] = unset;
    await this.collection().updateOne({ _id: raw._id }, update, { session });
  }

  /**
   * Preserve an un-normalizable record verbatim and remove it from the
   * live collection (P0-01): the data is never destroyed and never
   * silently reset — it is reported (error log with the structured
   * issue list) and recoverable by an operator from
   * `economy_quarantine`.
   *
   * Phase 6c (R1): the archive is an APPEND-ONLY EVENT, inserted
   * fresh every time. The Phase 6 code upserted with $setOnInsert
   * keyed by the record's _id, so a SECOND invalid record for the
   * same account silently discarded the newer evidence; and because
   * nothing recorded the freeze, ensureUser then created a fresh
   * starting-balance account over the archived one. Now the event's
   * existence freezes the account (see ensureUserInTxn) until
   * resolveQuarantine stamps it resolved.
   */
  private async quarantine(
    raw: WithId<EconomyDoc>,
    issues: readonly string[],
    attemptedUserId: string,
    session: ClientSession,
  ): Promise<void> {
    await this.quarantineCollection().insertOne(
      {
        userId: attemptedUserId,
        original: raw,
        issues: [...issues],
        attemptedUserId,
        quarantinedAt: new Date(),
        resolvedAt: null,
        resolution: null,
      },
      { session },
    );
    await this.collection().deleteOne({ _id: raw._id }, { session });
    this.logger?.error(
      { userId: attemptedUserId, issues },
      'economy record failed normalization and was quarantined (original preserved); account frozen pending operator resolution',
    );
  }

  /** Whether the account has a quarantine event no operator has resolved. */
  async hasUnresolvedQuarantine(userId: string, session?: ClientSession): Promise<boolean> {
    const event = await this.quarantineCollection().findOne(
      { userId, resolvedAt: null },
      sessionOpts(session),
    );
    return event !== null;
  }

  /**
   * Operator resolution for a frozen account (Phase 6c, R1): stamps
   * EVERY unresolved quarantine event for the user as resolved, and —
   * when `corrected` is provided — restores the account from the
   * operator-supplied corrected record. Passing null discards the
   * quarantined record(s): the account then starts fresh on its next
   * ensureUser. Refuses to overwrite a live record. Runs in one
   * transaction so the unfreeze and the restore commit together.
   */
  async resolveQuarantine(
    userId: string,
    corrected: EconomyUser | null,
  ): Promise<{ resolvedEvents: number; user: EconomyUser | null }> {
    if (corrected !== null && corrected.userId !== userId) {
      throw new EconomyError('The corrected record belongs to a different account.');
    }
    const session = this.handles.client.startSession();
    try {
      const holder: { result?: { resolvedEvents: number; user: EconomyUser | null } } = {};
      await session.withTransaction(async () => {
        const stamped = await this.quarantineCollection().updateMany(
          { userId, resolvedAt: null },
          {
            $set: {
              resolvedAt: new Date(),
              resolution: corrected !== null ? 'restored' : 'discarded',
            },
          },
          { session },
        );
        let user: EconomyUser | null = null;
        if (corrected !== null) {
          // Phase 6e (R1): the live record may itself be the corrupt
          // one — discovery here is quarantined INLINE (this
          // resolution transaction is the operator's remedy, not a
          // doomed financial operation) and treated as "no live
          // record", so the corrected record can be restored over it.
          let existing: EconomyUser | null = null;
          try {
            existing = await this.loadUserInTxn(userId, session);
          } catch (error) {
            if (!(error instanceof QuarantineDiscoveredError)) throw error;
            await this.quarantine(error.original, error.issues, error.userId, session);
            // `existing` stays null — the corrupt record is archived.
          }
          if (existing !== null) {
            throw new EconomyError(
              'Account already has a live record; refusing to overwrite it during quarantine resolution.',
            );
          }
          await this.collection().insertOne(toDocument(corrected) as unknown as EconomyDoc, {
            session,
          });
          // The inline quarantine above recorded a fresh UNRESOLVED
          // event for the record just replaced; the operator's
          // corrected restore IS its resolution — stamp it (and any
          // other straggler) so the account is not left frozen.
          await this.quarantineCollection().updateMany(
            { userId, resolvedAt: null },
            { $set: { resolvedAt: new Date(), resolution: 'restored' } },
            { session },
          );
          user = corrected;
        }
        holder.result = { resolvedEvents: stamped.modifiedCount, user };
      });
      return holder.result as { resolvedEvents: number; user: EconomyUser | null };
    } finally {
      await session.endSession();
    }
  }

  // ---------------------------------------------------------- accounts

  /**
   * Create the account if missing (starting wallet 5000, bank 0 — the
   * old bank_funcs defaults) and return the normalized user.
   * Idempotent, and safe under concurrency: creation happens inside a
   * transaction, so racing creators converge on one document (and a
   * create aborted by a failed surrounding operation leaves nothing
   * behind).
   */
  async ensureUser(userId: string, session?: ClientSession): Promise<EconomyUser> {
    if (session !== undefined) return this.ensureUserInTxn(userId, session);
    // Phase 6e (R1): the freeze check comes FIRST — before the
    // loadUser early return. Phase 6c checked only on the
    // no-live-record path, so a valid record (re)appearing while an
    // event was unresolved (operator restore outside resolveQuarantine,
    // a racing repair) silently un-froze the account and money moved.
    // An unresolved quarantine event is authoritative: it blocks
    // regardless of what the live collection currently holds.
    if (await this.hasUnresolvedQuarantine(userId)) {
      throw new QuarantinedAccountError(userId);
    }
    const existing = await this.loadUser(userId);
    if (existing !== null) return existing;
    const createSession = this.handles.client.startSession();
    try {
      let created: EconomyUser = emptyUser(userId);
      try {
        await createSession.withTransaction(async () => {
          created = await this.ensureUserInTxn(userId, createSession);
        });
      } catch (error) {
        // Corruption discovered inside the create transaction: the
        // transaction aborted, so persist the quarantine in its own
        // transaction before surfacing the freeze (Phase 6e, R1).
        if (error instanceof QuarantineDiscoveredError) {
          await this.persistQuarantine(error);
          throw new QuarantinedAccountError(error.userId);
        }
        throw error;
      }
      return created;
    } finally {
      await createSession.endSession();
    }
  }

  private async ensureUserInTxn(userId: string, session: ClientSession): Promise<EconomyUser> {
    // Phase 6c (R1) FREEZE, Phase 6e (R1) ordering: the unresolved-
    // quarantine check runs BEFORE loading the live record. The
    // Phase 6c order (load first, check only when no record exists)
    // let a valid live record bypass the freeze entirely — an
    // unresolved event means the account's real record was invalid
    // and archived, and no financial mutation may proceed against
    // ANY live record until an operator resolves it. (Creating a
    // fresh starting-balance account over the archive — the Phase 6
    // behavior — would silently orphan the real balance.)
    if (await this.hasUnresolvedQuarantine(userId, session)) {
      throw new QuarantinedAccountError(userId);
    }
    const existing = await this.loadUserInTxn(userId, session);
    if (existing !== null) return existing;
    const fresh = emptyUser(userId);
    await this.collection().insertOne(toDocument(fresh) as unknown as EconomyDoc, { session });
    return fresh;
  }

  // ------------------------------------------------------- primitives

  /**
   * Credit a balance field, guarded so the result can never exceed
   * the safe-integer ceiling (P0-02): the filter requires
   * `field <= MAX_SAFE_INTEGER - amount`. A non-match is diagnosed —
   * missing account vs overflow — and overflow throws, aborting any
   * surrounding transaction (a transfer that would overflow its
   * recipient moves NOTHING).
   */
  async credit(
    userId: string,
    field: 'wallet' | 'bank',
    amount: number,
    session?: ClientSession,
  ): Promise<void> {
    if (!isValidAmount(amount)) throw new InvalidAmountError();
    const result = await this.collection().updateOne(
      { userId, [field]: { $lte: MAX_SAFE - amount } },
      { $inc: { [field]: amount } },
      sessionOpts(session),
    );
    if (result.matchedCount === 0) {
      const user = await this.loadUser(userId, session);
      if (user === null) throw new EconomyError('Account not found.');
      throw new BalanceOverflowError(field);
    }
  }

  /**
   * Debit a balance field only if the balance covers it (the guard is part
   * of the update filter). Returns false when the guard did not match —
   * insufficient funds or no such user.
   */
  async debitGuarded(
    userId: string,
    field: 'wallet' | 'bank',
    amount: number,
    session?: ClientSession,
  ): Promise<boolean> {
    if (!isValidAmount(amount)) throw new InvalidAmountError();
    const result = await this.collection().updateOne(
      { userId, [field]: { $gte: amount } },
      { $inc: { [field]: -amount } },
      sessionOpts(session),
    );
    return result.matchedCount > 0;
  }

  /**
   * Apply a signed wallet delta (admin adjustments). Negative deltas go
   * through the balance guard, so the wallet can never be driven below
   * zero; an uncovered negative delta throws. Positive deltas go
   * through the overflow-guarded credit (P0-02).
   */
  async adjustWallet(userId: string, delta: number, session?: ClientSession): Promise<void> {
    if (!Number.isSafeInteger(delta) || delta === 0) {
      if (delta === 0) return;
      throw new InvalidAmountError();
    }
    if (delta > 0) {
      await this.credit(userId, 'wallet', delta, session);
      return;
    }
    const ok = await this.debitGuarded(userId, 'wallet', -delta, session);
    if (!ok) throw new InsufficientFundsError();
  }

  // ------------------------------------------------------ idempotency

  /**
   * A stored ledger record only replays for the operation it was
   * committed by (Phase 6c, R3): kind, actor, and params must all
   * match the replay's key. A mismatch means the interaction id was
   * reused for a different operation — a conflict, never a receipt.
   */
  private assertReceiptBinding(doc: IdempotencyDoc, idem: IdempotencyKey): void {
    const sameParams = JSON.stringify(doc.params ?? null) === JSON.stringify(idem.params ?? null);
    if (doc.kind !== idem.kind || doc.actorId !== idem.actorId || !sameParams) {
      throw new IdempotencyConflictError();
    }
  }

  /**
   * The committed receipt for an idempotency key, or null when the
   * operation has not committed (Phase 6c, R3). The service layer
   * checks this BEFORE any state-dependent validation, so a replayed
   * interaction returns its original outcome verbatim — even when the
   * same request would fail against current state (a full-wallet /pay
   * replayed after the wallet emptied, a game whose RNG would now
   * roll differently).
   */
  async findReceipt(idem: IdempotencyKey): Promise<unknown> {
    const doc = await this.idempotencyCollection().findOne({ _id: idem.id });
    if (doc === null) return null;
    this.assertReceiptBinding(doc, idem);
    return doc.result;
  }

  /**
   * Run `op` in a transaction, storing its return value as the
   * operation's receipt under `idem` (Phase 6c, R3) — the public,
   * service-facing form of runIdempotent with identity coding: the
   * service's op builds the COMPLETE receipt (actual amount moved,
   * game outcome/delta, resulting balances) from the in-transaction
   * core's result, and that receipt is what a replay returns.
   */
  async executeIdempotent<T>(
    idem: IdempotencyKey | undefined,
    op: (session: ClientSession) => Promise<T>,
  ): Promise<T> {
    return this.runIdempotent(
      idem,
      op,
      (result) => result,
      (stored) => stored as T,
    );
  }

  /**
   * Run `op` in a transaction. When an idempotency key is given, the
   * ledger record is inserted in the SAME transaction (P1-01/G3): a
   * replay — whether it arrives before or after the original commits —
   * returns the stored result and performs no mutation. The ledger is
   * checked first (fast path for the common redelivery), AGAIN inside
   * the transaction before `op` runs (Phase 6c, R3: a withTransaction
   * retry after a transient commit failure must find the receipt the
   * first attempt committed instead of re-executing the mutation),
   * and a duplicate-key abort on the insert resolves to the stored
   * record.
   */
  private async runIdempotent<T>(
    idem: IdempotencyKey | undefined,
    op: (session: ClientSession) => Promise<T>,
    encode: (result: T) => unknown,
    decode: (stored: unknown) => T,
  ): Promise<T> {
    if (idem !== undefined) {
      const existing = await this.idempotencyCollection().findOne({ _id: idem.id });
      if (existing !== null) {
        this.assertReceiptBinding(existing, idem);
        return decode(existing.result);
      }
    }
    const session = this.handles.client.startSession();
    try {
      const holder: { result?: T } = {};
      await session.withTransaction(async () => {
        if (idem !== undefined) {
          const committed = await this.idempotencyCollection().findOne(
            { _id: idem.id },
            { session },
          );
          if (committed !== null) {
            this.assertReceiptBinding(committed, idem);
            holder.result = decode(committed.result);
            return;
          }
        }
        holder.result = await op(session);
        if (idem !== undefined) {
          await this.idempotencyCollection().insertOne(
            {
              _id: idem.id,
              kind: idem.kind,
              actorId: idem.actorId,
              ...(idem.params !== undefined ? { params: idem.params } : {}),
              result: encode(holder.result),
              createdAt: new Date(),
            },
            { session },
          );
        }
      });
      return holder.result as T;
    } catch (error) {
      // Phase 6e (R1): corruption discovered inside this financial
      // transaction. The transaction has aborted — no portion of the
      // operation committed — and any quarantine write attempted
      // inside it aborted with it. Persist the discovery in its OWN
      // transaction, then surface the freeze. (Every public financial
      // mutation funnels through here or ensureUser, so this catch +
      // ensureUser's are the two persistence boundaries.)
      if (error instanceof QuarantineDiscoveredError) {
        await this.persistQuarantine(error);
        throw new QuarantinedAccountError(error.userId);
      }
      if (idem !== undefined && isDuplicateKeyError(error)) {
        const stored = await this.idempotencyCollection().findOne({ _id: idem.id });
        if (stored !== null) {
          this.assertReceiptBinding(stored, idem);
          return decode(stored.result);
        }
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }

  // -------------------------------------------------------- mutations

  /**
   * Transfer wallet → wallet between two users, atomically. The debit's
   * balance guard runs inside the transaction (PLAN §6); if it does not
   * match, the transaction aborts and neither balance changes. Returns
   * the transactional snapshots (P2-02) — never a post-commit re-read.
   */
  async transfer(
    fromId: string,
    toId: string,
    amount: number,
    idem?: IdempotencyKey,
  ): Promise<{ from: EconomyUser; to: EconomyUser }> {
    if (!isValidAmount(amount)) throw new InvalidAmountError();
    if (fromId === toId) throw new SelfTransferError();

    return this.runIdempotent(
      idem,
      (session) => this.transferInTxn(session, fromId, toId, amount),
      (result) => result,
      (stored) => stored as { from: EconomyUser; to: EconomyUser },
    );
  }

  /**
   * The transfer core, inside the caller's transaction (Phase 6c,
   * R3): shared by transfer() and by the service layer, which wraps
   * it in executeIdempotent to store its own complete receipt.
   * Callers validate amount/self-transfer before entering.
   */
  async transferInTxn(
    session: ClientSession,
    fromId: string,
    toId: string,
    amount: number,
  ): Promise<{ from: EconomyUser; to: EconomyUser }> {
    await this.ensureUserInTxn(fromId, session);
    await this.ensureUserInTxn(toId, session);
    const debited = await this.debitGuarded(fromId, 'wallet', amount, session);
    if (!debited) {
      throw new InsufficientFundsError("You don't have enough money in your wallet for that.");
    }
    await this.credit(toId, 'wallet', amount, session);
    const from = await this.loadUserInTxn(fromId, session);
    const to = await this.loadUserInTxn(toId, session);
    if (from === null || to === null) throw new EconomyError('Account vanished mid-transfer.');
    return { from, to };
  }

  /** Move money between a user's own wallet and bank, atomically. */
  async moveFunds(
    userId: string,
    fromField: 'wallet' | 'bank',
    amount: number,
    idem?: IdempotencyKey,
  ): Promise<EconomyUser> {
    if (!isValidAmount(amount)) throw new InvalidAmountError();

    return this.runIdempotent(
      idem,
      (session) => this.moveFundsInTxn(session, userId, fromField, amount),
      (result) => result,
      (stored) => stored as EconomyUser,
    );
  }

  /** The moveFunds core, inside the caller's transaction (Phase 6c, R3). */
  async moveFundsInTxn(
    session: ClientSession,
    userId: string,
    fromField: 'wallet' | 'bank',
    amount: number,
  ): Promise<EconomyUser> {
    const toField = fromField === 'wallet' ? 'bank' : 'wallet';
    await this.ensureUserInTxn(userId, session);
    const debited = await this.debitGuarded(userId, fromField, amount, session);
    if (!debited) {
      throw new InsufficientFundsError(
        fromField === 'wallet'
          ? "You don't have that much in your wallet."
          : "You don't have that much in your bank.",
      );
    }
    await this.credit(userId, toField, amount, session);
    const user = await this.loadUserInTxn(userId, session);
    if (user === null) throw new EconomyError('Account vanished mid-move.');
    return user;
  }

  /**
   * Settle a game bet as ONE atomic conditional update (Phase 6,
   * P1-02/G2). The Phase 2 shape — read a snapshot, check it, then
   * credit wins unconditionally and debit losses through a separate
   * guard — let two concurrent settlements both pass the snapshot
   * check and overdraw or double-pay. Here the filter requires stake
   * coverage (`wallet >= bet`) for BOTH outcomes, plus headroom under
   * the safe-integer ceiling on a win; the RNG outcome was generated
   * once by the caller and is never rerolled here, so transaction
   * retries are safe.
   */
  async settleBet(
    userId: string,
    bet: number,
    delta: number,
    idem?: IdempotencyKey,
  ): Promise<EconomyUser> {
    if (!isValidAmount(bet)) throw new InvalidAmountError();
    if (!Number.isSafeInteger(delta) || Math.abs(delta) > bet) {
      throw new InvalidAmountError('Settlement delta must be within the stake.');
    }
    return this.runIdempotent(
      idem,
      (session) => this.settleBetInTxn(session, userId, bet, delta),
      (result) => result,
      (stored) => stored as EconomyUser,
    );
  }

  /** The settleBet core, inside the caller's transaction (Phase 6c, R3). */
  async settleBetInTxn(
    session: ClientSession,
    userId: string,
    bet: number,
    delta: number,
  ): Promise<EconomyUser> {
    await this.ensureUserInTxn(userId, session);
    if (delta === 0) {
      // Phase 6c (cheap P2, GPT): a push still SETTLES the bet — the
      // Phase 6 branch returned the user without verifying the wallet
      // ever covered the stake, so a push could "settle" a bet the
      // user could not have placed.
      const user = await this.loadUserInTxn(userId, session);
      if (user === null) throw new EconomyError('Account vanished mid-settlement.');
      if (user.wallet < bet) {
        throw new InsufficientFundsError(
          "You don't have enough money in your wallet for that bet.",
        );
      }
      return user;
    }
    const filter: Document =
      delta > 0
        ? { userId, wallet: { $gte: bet, $lte: MAX_SAFE - delta } }
        : { userId, wallet: { $gte: bet } };
    const updated = await this.collection().findOneAndUpdate(
      filter,
      { $inc: { wallet: delta } },
      { returnDocument: 'after', session },
    );
    if (updated === null) {
      const user = await this.loadUserInTxn(userId, session);
      if (user === null) throw new EconomyError('Account not found.');
      if (user.wallet < bet) {
        throw new InsufficientFundsError(
          "You don't have enough money in your wallet for that bet.",
        );
      }
      throw new BalanceOverflowError('wallet');
    }
    const norm = normalizeEconomyUser(updated);
    if (!norm.ok) throw new EconomyError('Account record is invalid.');
    return norm.user;
  }

  /**
   * Claim a timed reward as ONE conditional update: the filter requires the
   * stored last-claim timestamp to be missing or older than the cooldown,
   * and the same operation credits the wallet and stamps the new timestamp.
   * Two simultaneous claims cannot both match — exactly one wins. The
   * filter also carries the safe-integer headroom guard (P0-02): a claim
   * that would overflow the wallet is refused (BalanceOverflowError)
   * rather than wrapping the balance.
   */
  async claimReward(
    userId: string,
    kind: RewardKind,
    amount: number,
    now: number = Date.now(),
  ): Promise<ClaimResult> {
    if (!isValidAmount(amount)) throw new InvalidAmountError();
    const def = REWARDS[kind];
    const lastField = def.lastField;
    await this.ensureUser(userId);

    const result = await this.collection().updateOne(
      {
        userId,
        wallet: { $lte: MAX_SAFE - amount },
        $or: [{ [lastField]: null }, { [lastField]: { $lte: now - def.cooldownMs } }],
      },
      { $inc: { wallet: amount }, $set: { [lastField]: now } },
    );
    if (result.matchedCount > 0) {
      return { claimed: true, amount, nextAvailableAt: now + def.cooldownMs };
    }
    const user = await this.getUser(userId);
    const last = user === null ? null : user[lastField];
    const cooldownOver = last === null || last <= now - def.cooldownMs;
    if (user !== null && cooldownOver && user.wallet > MAX_SAFE - amount) {
      throw new BalanceOverflowError('wallet');
    }
    return {
      claimed: false,
      amount: 0,
      nextAvailableAt: (last ?? now) + def.cooldownMs,
    };
  }

  /**
   * Attempt a robbery as ONE transaction (Phase 6, P2-01/G2): the
   * cooldown check, the cooldown stamp, and the settlement all commit
   * or all roll back together. Consequences:
   * - a rob that legitimately resolves (steal / nothing / caught)
   *   consumes the cooldown — as the old bot's command cooldown did;
   * - an INFRASTRUCTURE failure consumes nothing (the stamp rolls
   *   back with the transaction) — orchestrator ruling 6;
   * - the fine is clamped against the TRANSACTIONAL wallet, so a
   *   concurrent deposit cannot be used to evade it, and the steal is
   *   capped at the target's transactional balance, with the reported
   *   outcome adjusted to what actually moved.
   * The RNG rolls are drawn by the caller, once (P1-02).
   */
  async rob(
    robberId: string,
    targetId: string,
    amount: number,
    rolls: { readonly band: number; readonly fraction: number },
    idem?: IdempotencyKey,
    now: number = Date.now(),
  ): Promise<RobTxResult> {
    if (!isValidAmount(amount)) throw new InvalidAmountError();
    if (robberId === targetId) throw new SelfTransferError("You can't rob yourself.");

    return this.runIdempotent(
      idem,
      (session) => this.robInTxn(session, robberId, targetId, amount, rolls, now),
      (result) => result,
      (stored) => stored as RobTxResult,
    );
  }

  /** The rob core, inside the caller's transaction (Phase 6c, R3). */
  async robInTxn(
    session: ClientSession,
    robberId: string,
    targetId: string,
    amount: number,
    rolls: { readonly band: number; readonly fraction: number },
    now: number,
  ): Promise<RobTxResult> {
    const robberBefore = await this.ensureUserInTxn(robberId, session);
    const targetBefore = await this.ensureUserInTxn(targetId, session);
    if (robberBefore.lastRobbed !== null && robberBefore.lastRobbed > now - ROB_COOLDOWN_MS) {
      throw new RobCooldownError(robberBefore.lastRobbed + ROB_COOLDOWN_MS);
    }

    const rolled = robFromRolls(amount, rolls.band, rolls.fraction);
    await this.collection().updateOne(
      { userId: robberId },
      { $set: { lastRobbed: now } },
      { session },
    );

    let fineApplied = 0;
    let outcome = rolled;
    if (rolled.stolen > 0) {
      const stolen = Math.min(rolled.stolen, targetBefore.wallet);
      if (stolen <= 0) {
        outcome = { kind: 'nothing', stolen: 0, fine: 0, robberDelta: 0, targetDelta: 0 };
      } else {
        const debited = await this.debitGuarded(targetId, 'wallet', stolen, session);
        if (!debited) throw new EconomyError('Rob failed: the target balance changed.');
        await this.credit(robberId, 'wallet', stolen, session);
        outcome = { ...rolled, stolen, robberDelta: stolen, targetDelta: -stolen };
      }
    } else if (rolled.kind === 'caught') {
      fineApplied = Math.min(rolled.fine, robberBefore.wallet);
      if (fineApplied > 0) {
        const debited = await this.debitGuarded(robberId, 'wallet', fineApplied, session);
        if (!debited) throw new EconomyError('Rob failed: the fine could not be collected.');
      }
    }

    const robber = await this.loadUserInTxn(robberId, session);
    const target = await this.loadUserInTxn(targetId, session);
    if (robber === null || target === null) {
      throw new EconomyError('Account vanished mid-rob.');
    }
    return { outcome, fineApplied, robber, target };
  }

  /**
   * Add qty of an item as ONE atomic pipeline update (Phase 6, P2-03):
   * the old update-then-push pair could duplicate the entry (or lose
   * the increment) under concurrency. The pipeline increments the
   * matching element when present and appends otherwise — a single
   * server-side operation.
   */
  /**
   * Add qty of an item as ONE atomic pipeline update (Phase 6, P2-03):
   * the old update-then-push pair could duplicate the entry (or lose
   * the increment) under concurrency. The pipeline increments the
   * matching element when present and appends otherwise — a single
   * server-side operation.
   *
   * Phase 6c (R2): the increment is GUARDED in the update filter — the
   * entry must be absent (append) or its quantity must leave headroom
   * under the safe-integer ceiling. The Phase 6 pipeline's `$add` was
   * unbounded, so a quantity could be pushed past MAX_SAFE_INTEGER
   * into double-precision loss. A non-match is diagnosed (missing
   * account vs overflow) like credit().
   */
  async addItem(userId: string, itemId: number, qty = 1, session?: ClientSession): Promise<void> {
    if (!isValidAmount(qty)) throw new InvalidAmountError();
    const pipeline: Document[] = [
      {
        $set: {
          inventory: {
            $cond: {
              if: {
                $in: [
                  itemId,
                  {
                    $map: {
                      input: { $ifNull: ['$inventory', []] },
                      as: 'entry',
                      in: '$$entry.itemId',
                    },
                  },
                ],
              },
              then: {
                $map: {
                  input: '$inventory',
                  as: 'entry',
                  in: {
                    $cond: [
                      { $eq: ['$$entry.itemId', itemId] },
                      { itemId: '$$entry.itemId', qty: { $add: ['$$entry.qty', qty] } },
                      '$$entry',
                    ],
                  },
                },
              },
              else: { $concatArrays: [{ $ifNull: ['$inventory', []] }, [{ itemId, qty }]] },
            },
          },
        },
      },
    ];
    const guardedFilter: Document = {
      userId,
      $or: [
        { inventory: { $not: { $elemMatch: { itemId } } } },
        { inventory: { $elemMatch: { itemId, qty: { $lte: MAX_SAFE - qty } } } },
      ],
    };
    const result = await this.collection().updateOne(guardedFilter, pipeline, sessionOpts(session));
    if (result.matchedCount === 0) {
      const user = await this.loadUser(userId, session);
      if (user === null) throw new EconomyError('Account not found.');
      throw new InventoryOverflowError();
    }
  }

  /**
   * Remove qty of an item as ONE atomic pipeline update (Phase 6,
   * G10): the $elemMatch guard pins ownership, and the same operation
   * filters out the zero-quantity tombstone the decrement leaves
   * behind (the old shape needed a separate $pull that could be lost).
   * Returns false when the user does not own that many.
   */
  async removeItemGuarded(
    userId: string,
    itemId: number,
    qty: number,
    session?: ClientSession,
  ): Promise<boolean> {
    if (!isValidAmount(qty)) throw new InvalidAmountError();
    const pipeline: Document[] = [
      {
        $set: {
          inventory: {
            $filter: {
              input: {
                $map: {
                  input: { $ifNull: ['$inventory', []] },
                  as: 'entry',
                  in: {
                    $cond: [
                      { $eq: ['$$entry.itemId', itemId] },
                      { itemId: '$$entry.itemId', qty: { $subtract: ['$$entry.qty', qty] } },
                      '$$entry',
                    ],
                  },
                },
              },
              as: 'entry',
              cond: { $gt: ['$$entry.qty', 0] },
            },
          },
        },
      },
    ];
    const result = await this.collection().updateOne(
      { userId, inventory: { $elemMatch: { itemId, qty: { $gte: qty } } } },
      pipeline,
      sessionOpts(session),
    );
    return result.matchedCount > 0;
  }

  /** Buy qty of a catalog item: guarded wallet debit + inventory credit, atomically. */
  async purchase(
    userId: string,
    item: ShopItem,
    qty = 1,
    idem?: IdempotencyKey,
  ): Promise<EconomyUser> {
    if (!isValidAmount(qty)) throw new InvalidAmountError();
    const total = buyPrice(item) * qty;
    if (!Number.isSafeInteger(total)) throw new InvalidAmountError();
    return this.runIdempotent(
      idem,
      (session) => this.purchaseInTxn(session, userId, item, qty),
      (result) => result,
      (stored) => stored as EconomyUser,
    );
  }

  /** The purchase core, inside the caller's transaction (Phase 6c, R3). */
  async purchaseInTxn(
    session: ClientSession,
    userId: string,
    item: ShopItem,
    qty: number,
  ): Promise<EconomyUser> {
    const total = buyPrice(item) * qty;
    await this.ensureUserInTxn(userId, session);
    const debited = await this.debitGuarded(userId, 'wallet', total, session);
    if (!debited) {
      throw new InsufficientFundsError(
        `You don't have enough money to buy ${item.name}. It costs ${total}.`,
      );
    }
    await this.addItem(userId, item.id, qty, session);
    const user = await this.loadUserInTxn(userId, session);
    if (user === null) throw new EconomyError('Account vanished mid-purchase.');
    return user;
  }

  /** Sell one of a catalog item back: guarded inventory debit + wallet credit, atomically. */
  async sellBack(userId: string, item: ShopItem, idem?: IdempotencyKey): Promise<EconomyUser> {
    return this.runIdempotent(
      idem,
      (session) => this.sellBackInTxn(session, userId, item),
      (result) => result,
      (stored) => stored as EconomyUser,
    );
  }

  /** The sellBack core, inside the caller's transaction (Phase 6c, R3). */
  async sellBackInTxn(
    session: ClientSession,
    userId: string,
    item: ShopItem,
  ): Promise<EconomyUser> {
    await this.ensureUserInTxn(userId, session);
    const removed = await this.removeItemGuarded(userId, item.id, 1, session);
    if (!removed) throw new NotOwnedError(`You don't have a ${item.name} to sell.`);
    await this.credit(userId, 'wallet', sellPrice(item), session);
    const user = await this.loadUserInTxn(userId, session);
    if (user === null) throw new EconomyError('Account vanished mid-sale.');
    return user;
  }

  /**
   * Top users by net worth (wallet + bank), descending, with a
   * deterministic tie-break on userId ascending. Legacy string balances are
   * converted defensively in the aggregation so one bad document cannot
   * break the board. Records that fail normalization are skipped here
   * (they are quarantined on their next direct read).
   *
   * Phase 6c (R2): net worth is EXACT. The Phase 6 aggregation summed
   * DOUBLES and the entry summed JS numbers — a wallet at
   * MAX_SAFE_INTEGER plus 2 in the bank is not representable as a
   * double, so ordering and the displayed net could both be wrong at
   * the ceiling. The aggregation now sums Decimal128 (exact for any
   * safe-integer pair), and the entry's net is a BigInt sum of the
   * normalized balances.
   */
  async leaderboard(limit = 10): Promise<LeaderboardEntry[]> {
    const capped = Math.min(100, Math.max(1, Math.floor(limit)));
    const rows = await this.collection()
      .aggregate([
        {
          $addFields: {
            walletDec: { $convert: { input: '$wallet', to: 'decimal', onError: 0, onNull: 0 } },
            bankDec: { $convert: { input: '$bank', to: 'decimal', onError: 0, onNull: 0 } },
            sortId: { $ifNull: ['$userId', '$_id'] },
          },
        },
        { $addFields: { net: { $add: ['$walletDec', '$bankDec'] } } },
        { $sort: { net: -1, sortId: 1 } },
        { $limit: capped },
      ])
      .toArray();

    const entries: LeaderboardEntry[] = [];
    for (const row of rows) {
      const norm = normalizeEconomyUser(row);
      if (!norm.ok) continue;
      entries.push({
        userId: norm.user.userId,
        wallet: norm.user.wallet,
        bank: norm.user.bank,
        net: BigInt(norm.user.wallet) + BigInt(norm.user.bank),
      });
    }
    return entries;
  }
}

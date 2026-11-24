import { SHOP_ITEMS } from './shop.js';

/**
 * Economy data model (PLAN §6) — GLOBAL economy: one document per Discord
 * user, keyed by `userId`, in the `economy` collection.
 *
 * The old bot split this across two collections (`bank`: {_id, wallet, bank}
 * and `inventory`: {_id, watch, mobile, laptop} as flat per-item fields) and
 * read fields positionally via Object.values() (AUDIT §5.18). The v3 shape
 * unifies both into one document with a typed inventory array. The
 * normalizer below accepts both the v3 shape and the legacy shapes so a
 * legacy document can never crash a read.
 */

export const ECONOMY_COLLECTION = 'economy';

/** Starting balances for a brand-new account (old bank_funcs.js `document`). */
export const STARTING_WALLET = 5000;
export const STARTING_BANK = 0;

export interface InventoryEntry {
  readonly itemId: number;
  readonly qty: number;
}

/**
 * A normalized economy user. Timestamps are epoch milliseconds; `null`
 * means "never claimed / never attempted", i.e. immediately available.
 */
export interface EconomyUser {
  readonly userId: string;
  readonly wallet: number;
  readonly bank: number;
  readonly inventory: readonly InventoryEntry[];
  readonly lastDaily: number | null;
  readonly lastWeekly: number | null;
  readonly lastMonthly: number | null;
  readonly lastRobbed: number | null;
}

export function emptyUser(userId: string): EconomyUser {
  return {
    userId,
    wallet: STARTING_WALLET,
    bank: STARTING_BANK,
    inventory: [],
    lastDaily: null,
    lastWeekly: null,
    lastMonthly: null,
    lastRobbed: null,
  };
}

export type RewardKind = 'daily' | 'weekly' | 'monthly';

export interface RewardDef {
  readonly min: number;
  readonly max: number;
  readonly cooldownMs: number;
  /** EconomyUser field that stores the last-claim timestamp. */
  readonly lastField: 'lastDaily' | 'lastWeekly' | 'lastMonthly';
}

/**
 * Reward table — parity with the old economy.js: daily randint(3000, 5000)
 * on a 24 h cooldown, weekly randint(7000, 10000) on 7 d, monthly
 * randint(30000, 50000) on 30 d. (Old cooldowns were in-memory and reset on
 * restart, AUDIT §1.7; v3 persists the timestamps on the document.)
 */
export const REWARDS: Readonly<Record<RewardKind, RewardDef>> = {
  daily: { min: 3000, max: 5000, cooldownMs: 24 * 3600 * 1000, lastField: 'lastDaily' },
  weekly: { min: 7000, max: 10000, cooldownMs: 7 * 24 * 3600 * 1000, lastField: 'lastWeekly' },
  monthly: { min: 30000, max: 50000, cooldownMs: 30 * 24 * 3600 * 1000, lastField: 'lastMonthly' },
};

/**
 * Normalization outcome (Phase 6, AUDIT6 P0-01 / G10).
 *
 * Normalization (ok: true) covers every value that can be carried into
 * the v3 shape: numeric strings, missing fields, legacy layouts. It is
 * NOT lossless in general — fractional values are FLOORED and
 * unrepresentable inventory entries are DROPPED; every such change is
 * reported in `issues` (and the repair write-back makes it durable).
 * A document whose IDENTITY is ambiguous (userId field disagrees with
 * _id, or neither yields an id) or whose BALANCE cannot be represented
 * (garbage, NaN, negative, or beyond the safe-integer range) — or whose
 * merged inventory quantity would overflow the safe-integer range
 * (Phase 6c, R2) — is NOT normalized into a fabricated account: it is
 * rejected (ok: false) so the repository can QUARANTINE the original
 * document verbatim and report it. PLAN §6: invalid records are
 * reported, never silently reset.
 */
export type NormalizeResult =
  | {
      readonly ok: true;
      readonly user: EconomyUser;
      /** True when the raw document differed from the clean v3 shape. */
      readonly repaired: boolean;
      readonly issues: readonly string[];
    }
  | { readonly ok: false; readonly issues: readonly string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Coerce a legacy money field to a clean non-negative safe-integer
 * balance, or return null when the value cannot be a balance at all
 * (the caller quarantines the record). Representable coercions —
 * numeric strings, missing/null (defaulted) — succeed and are reported
 * in `issues`; fractional floats are floored (a real, reported change,
 * not a lossless one). Garbage strings, NaN/Infinity, unsafe integers,
 * negative values, and non-numeric types return null: manufacturing a
 * 0 for those would silently destroy a real balance (Phase 6,
 * P0-01/G10 — the Phase 2 version reset them to 0).
 */
function coerceBalance(value: unknown, field: string, issues: string[]): number | null {
  if (value === undefined || value === null) {
    issues.push(`${field}: missing, defaulted to 0`);
    return 0;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^-?\d+$/.test(trimmed)) {
      issues.push(`${field}: non-numeric string "${value}", invalid balance`);
      return null;
    }
    const num = Number(trimmed);
    if (!Number.isSafeInteger(num)) {
      issues.push(`${field}: numeric string outside the safe-integer range, invalid balance`);
      return null;
    }
    if (num < 0) {
      issues.push(`${field}: negative balance ${num}, invalid balance`);
      return null;
    }
    issues.push(`${field}: numeric string coerced to number`);
    return num;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      issues.push(`${field}: NaN/non-finite, invalid balance`);
      return null;
    }
    if (Number.isInteger(value)) {
      if (!Number.isSafeInteger(value)) {
        issues.push(`${field}: integer outside the safe range, invalid balance`);
        return null;
      }
      if (value < 0) {
        issues.push(`${field}: negative balance ${value}, invalid balance`);
        return null;
      }
      return value;
    }
    const floored = Math.floor(value);
    if (floored < 0 || !Number.isSafeInteger(floored)) {
      issues.push(`${field}: fractional balance ${value} out of range, invalid balance`);
      return null;
    }
    issues.push(`${field}: fractional balance ${value}, floored`);
    return floored;
  }
  issues.push(`${field}: unexpected type, invalid balance`);
  return null;
}

function coerceTimestamp(value: unknown, field: string, issues: string[]): number | null {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) {
    // Phase 6 (P2-03): a BSON Date must be REPORTED as a coercion —
    // silently converting it left `repaired` false, so the Date stayed
    // in the document and broke numeric cooldown comparisons later.
    issues.push(`${field}: BSON Date coerced to epoch milliseconds`);
    const ms = value.getTime();
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  }
  if (typeof value === 'number') {
    if (Number.isFinite(value) && value > 0) {
      if (!Number.isInteger(value)) issues.push(`${field}: fractional timestamp floored`);
      return Math.floor(value);
    }
    issues.push(`${field}: invalid timestamp ${value}, treated as never`);
    return null;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      issues.push(`${field}: date string coerced to timestamp`);
      return parsed;
    }
    const asNumber = Number(value);
    if (Number.isFinite(asNumber) && asNumber > 0) {
      issues.push(`${field}: numeric string coerced to timestamp`);
      return Math.floor(asNumber);
    }
    issues.push(`${field}: unparseable timestamp, treated as never`);
    return null;
  }
  issues.push(`${field}: unexpected timestamp type, treated as never`);
  return null;
}

/**
 * Coerce an inventory quantity. Returns the quantity and whether the
 * value needed coercion (string form) — Phase 6 (P2-03): string
 * quantities and dropped entries previously recorded NO issue, so
 * `repaired` stayed false and the raw values were never written back.
 *
 * Phase 6c (R2): the result must be a SAFE integer — the Phase 6 code
 * floored any finite positive number, so a stored quantity of 1e20
 * "normalized" to a value money-adjacent math cannot represent
 * exactly. Unsafe results are dropped (0) with an issue recorded.
 */
function coerceQty(value: unknown, issues: string[], context: string): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    if (!Number.isInteger(value))
      issues.push(`inventory: fractional quantity floored (${context})`);
    const floored = Math.floor(value);
    if (!Number.isSafeInteger(floored)) {
      issues.push(`inventory: quantity outside the safe-integer range dropped (${context})`);
      return 0;
    }
    return floored;
  }
  if (typeof value === 'string') {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) {
      const floored = Math.floor(num);
      if (!Number.isSafeInteger(floored)) {
        issues.push(`inventory: quantity outside the safe-integer range dropped (${context})`);
        return 0;
      }
      issues.push(`inventory: string quantity coerced (${context})`);
      return floored;
    }
  }
  return 0;
}

/**
 * Inventory can arrive as:
 * - v3 array of { itemId, qty } (or { id, qty } / { itemId, quantity }),
 * - legacy flat fields on the same document ({ watch: 2, mobile: 0, … }
 *   from the old `inventory` collection),
 * - an object map keyed by item name ({ watch: 2 }).
 */
function coerceInventory(
  raw: Record<string, unknown>,
  issues: string[],
): { entries: InventoryEntry[]; overflow: boolean } {
  const byId = new Map<number, number>();
  let overflow = false;
  const add = (itemId: number, qty: number): void => {
    if (qty <= 0) return;
    // Phase 6c (R2): duplicate merges use CHECKED addition — the
    // Phase 6 code summed raw JS numbers, so two individually-safe
    // quantities could merge into an unsafe one. An overflowing merge
    // cannot be represented: the record is rejected for quarantine
    // (never clamped, never wrapped).
    const merged = (byId.get(itemId) ?? 0) + qty;
    if (!Number.isSafeInteger(merged)) {
      overflow = true;
      issues.push(
        `inventory: merged quantity for item ${itemId} exceeds the safe-integer range, invalid record`,
      );
      return;
    }
    byId.set(itemId, merged);
  };

  const rawInventory = raw['inventory'];
  if (Array.isArray(rawInventory)) {
    for (const entry of rawInventory) {
      if (!isRecord(entry)) {
        issues.push('inventory: non-object entry dropped');
        continue;
      }
      const idValue = entry['itemId'] ?? entry['id'];
      const itemId = typeof idValue === 'number' ? idValue : Number(idValue);
      if (!Number.isInteger(itemId)) {
        issues.push('inventory: entry with invalid itemId dropped');
        continue;
      }
      const qty = coerceQty(
        entry['qty'] ?? entry['quantity'] ?? entry['count'],
        issues,
        `item ${itemId}`,
      );
      if (qty <= 0) {
        issues.push(`inventory: entry for item ${itemId} dropped (invalid quantity)`);
        continue;
      }
      if (byId.has(itemId)) issues.push(`inventory: duplicate entries for item ${itemId} merged`);
      add(itemId, qty);
    }
  } else if (isRecord(rawInventory)) {
    issues.push('inventory: object map converted to array');
    for (const item of SHOP_ITEMS) {
      add(item.id, coerceQty(rawInventory[item.name], issues, item.name));
    }
  }

  // Legacy flat per-item fields (old inventory collection shape).
  let sawFlat = false;
  for (const item of SHOP_ITEMS) {
    if (item.name in raw) {
      sawFlat = true;
      add(item.id, coerceQty(raw[item.name], issues, item.name));
    }
  }
  if (sawFlat) issues.push('inventory: legacy flat item fields converted to array');

  const entries = [...byId.entries()]
    .map(([itemId, qty]) => ({ itemId, qty }))
    .sort((a, b) => a.itemId - b.itemId);
  return { entries, overflow };
}

/** The id carried by the raw `_id` field alone, in string form. */
function idFromUnderscoreId(raw: Record<string, unknown>): string | undefined {
  const fromId = raw['_id'];
  if (typeof fromId === 'string' && fromId !== '') return fromId;
  if (typeof fromId === 'number' && Number.isFinite(fromId)) return String(fromId);
  // A Mongo ObjectId _id (never produced by the old bot, which used string
  // Discord ids) — read it through its hex form rather than String().
  if (
    typeof fromId === 'object' &&
    fromId !== null &&
    'toHexString' in fromId &&
    typeof fromId.toHexString === 'function'
  ) {
    return (fromId as { toHexString: () => string }).toHexString();
  }
  return undefined;
}

/**
 * Normalize any stored document (v3, legacy bank, legacy inventory, or a
 * merge of them) into a clean EconomyUser. NEVER throws.
 *
 * Phase 6 (P0-01 / P2-04): account identity is CANONICAL — `_id` and
 * `userId` must agree. A document where both are present and disagree,
 * or where neither yields an id, cannot be attributed to an account
 * and is rejected for quarantine instead of being silently attached
 * to whichever id a query happened to use.
 */
export function normalizeEconomyUser(raw: unknown): NormalizeResult {
  const issues: string[] = [];
  if (!isRecord(raw)) {
    issues.push('document: missing or not an object');
    return { ok: false, issues };
  }

  const fromField =
    typeof raw['userId'] === 'string' && raw['userId'] !== '' ? raw['userId'] : undefined;
  const fromId = idFromUnderscoreId(raw);
  if (fromField !== undefined && fromId !== undefined && fromField !== fromId) {
    issues.push(
      `identity: userId field "${fromField}" disagrees with _id "${fromId}", record cannot be attributed`,
    );
    return { ok: false, issues };
  }
  const userId = fromField ?? fromId;
  if (userId === undefined) {
    issues.push('userId: could not be determined from document');
    return { ok: false, issues };
  }
  if (fromField === undefined) {
    issues.push('userId: taken from legacy _id field');
  }

  const wallet = coerceBalance(raw['wallet'], 'wallet', issues);
  const bank = coerceBalance(raw['bank'], 'bank', issues);
  if (wallet === null || bank === null) {
    return { ok: false, issues };
  }
  const inventoryResult = coerceInventory(raw, issues);
  if (inventoryResult.overflow) {
    return { ok: false, issues };
  }
  const inventory = inventoryResult.entries;
  const lastDaily = coerceTimestamp(raw['lastDaily'], 'lastDaily', issues);
  const lastWeekly = coerceTimestamp(raw['lastWeekly'], 'lastWeekly', issues);
  const lastMonthly = coerceTimestamp(raw['lastMonthly'], 'lastMonthly', issues);
  const lastRobbed = coerceTimestamp(raw['lastRobbed'], 'lastRobbed', issues);

  const user: EconomyUser = {
    userId,
    wallet,
    bank,
    inventory,
    lastDaily,
    lastWeekly,
    lastMonthly,
    lastRobbed,
  };
  return { ok: true, user, repaired: issues.length > 0, issues };
}

/** The plain document shape written back to Mongo for a normalized user. */
export function toDocument(user: EconomyUser): Record<string, unknown> {
  return {
    _id: user.userId,
    userId: user.userId,
    wallet: user.wallet,
    bank: user.bank,
    inventory: user.inventory.map((entry) => ({ itemId: entry.itemId, qty: entry.qty })),
    lastDaily: user.lastDaily,
    lastWeekly: user.lastWeekly,
    lastMonthly: user.lastMonthly,
    lastRobbed: user.lastRobbed,
  };
}

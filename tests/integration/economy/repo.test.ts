import { MongoClient, MongoError, type Db } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { ensureIndexes } from '../../../src/db/indexes.js';
import {
  BalanceOverflowError,
  EconomyRepo,
  InsufficientFundsError,
  InvalidAmountError,
  InventoryOverflowError,
  NotOwnedError,
  QuarantinedAccountError,
  SelfTransferError,
} from '../../../src/features/economy/economy.repo.js';
import { EconomyService, RobCooldownError } from '../../../src/features/economy/economy.service.js';
import { buyPrice, itemById } from '../../../src/features/economy/shop.js';
import { ECONOMY_COLLECTION } from '../../../src/features/economy/types.js';

/**
 * Integration tests against a REAL MongoDB replica set (in-memory) —
 * transactions do not run on a standalone mongod, so MongoMemoryReplSet
 * is required (PLAN §6). These tests target the old data layer's failure
 * modes: non-atomic transfers, duplicate accounts, lost updates
 * (AUDIT §5.18–5.21).
 */

let client: MongoClient;
let db: Db;
let repo: EconomyRepo;
let service: EconomyService;

beforeAll(async () => {
  // Shared replica set from tests/global-setup.ts (Phase 6, G9).
  client = new MongoClient(inject('mongoUri'));
  await client.connect();
  db = client.db('cutiebot-test-economy');
  await ensureIndexes(db);
  repo = new EconomyRepo({ client, db });
  service = new EconomyService(repo);
}, 300_000);

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await rawCol().deleteMany({});
});

interface RawDoc {
  _id: string;
  [key: string]: unknown;
}

/** Raw collection access for seeding/asserting on stored documents. */
function rawCol() {
  return db.collection<RawDoc>(ECONOMY_COLLECTION);
}

async function walletOf(userId: string): Promise<number> {
  const user = await repo.getUser(userId);
  if (user === null) throw new Error(`no account for ${userId}`);
  return user.wallet;
}

describe('ensureUser', () => {
  it('creates an account with the old starting balances, exactly once', async () => {
    const first = await repo.ensureUser('u1');
    const second = await repo.ensureUser('u1');
    expect(first).toEqual(second);
    expect(first.wallet).toBe(5000);
    expect(first.bank).toBe(0);
    expect(await rawCol().countDocuments({ userId: 'u1' })).toBe(1);
  });

  it('is idempotent under concurrency — 10 racing calls, one document', async () => {
    await Promise.all(Array.from({ length: 10 }, () => repo.ensureUser('racer')));
    expect(await rawCol().countDocuments({ userId: 'racer' })).toBe(1);
  });
});

describe('transfer (transactional)', () => {
  it('moves money wallet → wallet', async () => {
    const { from, to } = await repo.transfer('alice', 'bob', 1000);
    expect(from.wallet).toBe(4000);
    expect(to.wallet).toBe(6000);
  });

  it('creates the recipient account on first transfer', async () => {
    await repo.transfer('alice', 'brand-new', 250);
    expect(await walletOf('brand-new')).toBe(5250);
  });

  it('rejects insufficient funds and leaves BOTH balances unchanged', async () => {
    await repo.ensureUser('alice');
    await repo.ensureUser('bob');
    await expect(repo.transfer('alice', 'bob', 6000)).rejects.toBeInstanceOf(
      InsufficientFundsError,
    );
    expect(await walletOf('alice')).toBe(5000);
    expect(await walletOf('bob')).toBe(5000);
  });

  it('rejects self-transfers before touching the database', async () => {
    await expect(repo.transfer('alice', 'alice', 100)).rejects.toBeInstanceOf(SelfTransferError);
  });

  it(
    'conserves total balance under concurrent transfers, never going negative',
    { timeout: 60_000 },
    async () => {
      await repo.ensureUser('alice');
      await repo.ensureUser('bob');
      const attempts: Promise<unknown>[] = [];
      for (let i = 0; i < 20; i++) {
        attempts.push(repo.transfer('alice', 'bob', 100).catch(() => undefined));
        attempts.push(repo.transfer('bob', 'alice', 100).catch(() => undefined));
      }
      await Promise.all(attempts);
      const alice = await repo.getUser('alice');
      const bob = await repo.getUser('bob');
      if (alice === null || bob === null) throw new Error('accounts vanished');
      expect(alice.wallet + bob.wallet).toBe(10_000);
      expect(alice.wallet).toBeGreaterThanOrEqual(0);
      expect(bob.wallet).toBeGreaterThanOrEqual(0);
    },
  );
});

describe('claimReward (single conditional update)', () => {
  it(
    'two simultaneous claims → exactly one succeeds, wallet credited once',
    { timeout: 60_000 },
    async () => {
      const [a, b] = await Promise.all([
        repo.claimReward('u1', 'daily', 4000),
        repo.claimReward('u1', 'daily', 4000),
      ]);
      expect([a.claimed, b.claimed].filter(Boolean)).toHaveLength(1);
      expect(await walletOf('u1')).toBe(9000);
    },
  );

  it('a second claim inside the cooldown is refused with the unlock time', async () => {
    const now = Date.now();
    const first = await repo.claimReward('u1', 'daily', 4000, now);
    expect(first.claimed).toBe(true);
    const second = await repo.claimReward('u1', 'daily', 4000, now + 1000);
    expect(second.claimed).toBe(false);
    expect(second.nextAvailableAt).toBe(now + 24 * 3600 * 1000);
    expect(await walletOf('u1')).toBe(9000);
  });

  it('a claim after the cooldown has elapsed succeeds', async () => {
    const now = Date.now();
    await repo.claimReward('u1', 'weekly', 8000, now - 8 * 24 * 3600 * 1000);
    const again = await repo.claimReward('u1', 'weekly', 8000, now);
    expect(again.claimed).toBe(true);
    expect(await walletOf('u1')).toBe(5000 + 16_000);
  });

  it('service.claim rolls the old daily range and then reports cooldown', async () => {
    const minService = new EconomyService(repo, () => 0); // rng 0 → minimum roll
    const claimed = await minService.claim('u9', 'daily');
    expect(claimed.status).toBe('claimed');
    if (claimed.status === 'claimed') expect(claimed.amount).toBe(3000);
    expect(await walletOf('u9')).toBe(8000);
    const refused = await minService.claim('u9', 'daily');
    expect(refused.status).toBe('cooldown');
  });
});

describe('deposit / withdraw (service + transactional moveFunds)', () => {
  it('moves wallet → bank and back, conserving the total', async () => {
    const deposited = await service.deposit('u1', '2000');
    expect(deposited.user.wallet).toBe(3000);
    expect(deposited.user.bank).toBe(2000);
    const withdrawn = await service.withdraw('u1', 'all');
    expect(withdrawn.amount).toBe(2000);
    expect(withdrawn.user.wallet).toBe(5000);
    expect(withdrawn.user.bank).toBe(0);
  });

  it('refuses to overdraw the bank and changes nothing', async () => {
    await expect(service.withdraw('u1', '1')).rejects.toBeInstanceOf(InsufficientFundsError);
    const user = await repo.getUser('u1');
    expect(user?.wallet).toBe(5000);
    expect(user?.bank).toBe(0);
  });

  it('refuses invalid amount strings before any mutation', async () => {
    await expect(service.deposit('u1', '10.5')).rejects.toThrow(/whole number/);
    await expect(service.deposit('u1', 'abc')).rejects.toThrow();
    expect(await walletOf('u1')).toBe(5000);
  });
});

describe('buy / sell (transactional)', () => {
  it('buy debits the wallet and credits the inventory atomically', async () => {
    const watch = itemById(1);
    if (watch === undefined) throw new Error('watch missing from catalog');
    const after = await repo.purchase('u1', watch);
    expect(after.wallet).toBe(4900);
    expect(after.inventory).toEqual([{ itemId: 1, qty: 1 }]);
    const again = await repo.purchase('u1', watch);
    expect(again.inventory).toEqual([{ itemId: 1, qty: 2 }]);
  });

  it('buy with insufficient funds changes neither balance nor inventory', async () => {
    const laptop = itemById(3);
    if (laptop === undefined) throw new Error('laptop missing from catalog');
    await repo.ensureUser('u1');
    await expect(repo.purchase('u1', laptop)).rejects.toBeInstanceOf(InsufficientFundsError);
    const user = await repo.getUser('u1');
    expect(user?.wallet).toBe(5000);
    expect(user?.inventory).toEqual([]);
  });

  it('a failed purchase for a brand-new user leaves no account behind (atomic abort)', async () => {
    const laptop = itemById(3);
    if (laptop === undefined) throw new Error('laptop missing from catalog');
    await expect(repo.purchase('ghost', laptop)).rejects.toBeInstanceOf(InsufficientFundsError);
    expect(await repo.getUser('ghost')).toBeNull();
  });

  it('sell credits round(cost / 4) and decrements the inventory; overselling is refused', async () => {
    const watch = itemById(1);
    if (watch === undefined) throw new Error('watch missing from catalog');
    await repo.purchase('u1', watch);
    const afterSell = await repo.sellBack('u1', watch);
    expect(afterSell.wallet).toBe(4900 + 25);
    // The normalized view drops zero-quantity entries.
    expect(afterSell.inventory).toEqual([]);
    await expect(repo.sellBack('u1', watch)).rejects.toBeInstanceOf(NotOwnedError);
    expect(await walletOf('u1')).toBe(4925);
  });
});

describe('leaderboard', () => {
  it('orders by net worth desc with a deterministic userId tie-break', async () => {
    const seed = async (userId: string, wallet: number, bank: number) => {
      await rawCol().insertOne({
        _id: userId,
        userId,
        wallet,
        bank,
        inventory: [],
        lastDaily: null,
        lastWeekly: null,
        lastMonthly: null,
        lastRobbed: null,
      });
    };
    await seed('user-b', 9000, 0);
    await seed('user-a', 4000, 5000); // same net as user-b → userId asc wins
    await seed('user-c', 100, 0);
    const board = await repo.leaderboard(10);
    expect(board.map((entry) => entry.userId)).toEqual(['user-a', 'user-b', 'user-c']);
    // Phase 6c (R2): net is an exact bigint.
    expect(board.map((entry) => entry.net)).toEqual([9000n, 9000n, 100n]);
  });

  // Phase 6c (R2): MAX_SAFE wallet + 2 bank is not representable as a
  // double — the Phase 6 double sum rounded it DOWN to a tie with
  // MAX_SAFE-1 + 2. Decimal128 aggregation + BigInt nets order and
  // report it exactly.
  it('computes net worth exactly at the safe-integer ceiling', async () => {
    const seed = async (userId: string, wallet: number, bank: number) => {
      await rawCol().insertOne({
        _id: userId,
        userId,
        wallet,
        bank,
        inventory: [],
        lastDaily: null,
        lastWeekly: null,
        lastMonthly: null,
        lastRobbed: null,
      });
    };
    await seed('exact-b', Number.MAX_SAFE_INTEGER - 1, 2); // net 2^53
    await seed('exact-a', Number.MAX_SAFE_INTEGER, 2); // net 2^53 + 1
    const board = await repo.leaderboard(10);
    expect(board.map((entry) => entry.userId)).toEqual(['exact-a', 'exact-b']);
    expect(board[0]?.net).toBe(BigInt(Number.MAX_SAFE_INTEGER) + 2n);
    expect(board[1]?.net).toBe(BigInt(Number.MAX_SAFE_INTEGER) + 1n);
  });

  it('respects the limit', async () => {
    for (const id of ['l1', 'l2', 'l3']) await repo.ensureUser(id);
    expect(await repo.leaderboard(2)).toHaveLength(2);
  });
});

describe('legacy documents', () => {
  it('reads a legacy bank doc (no userId field) and repairs it in place', async () => {
    await rawCol().insertOne({ _id: 'legacy-1', wallet: 777, bank: 3 });
    const user = await repo.getUser('legacy-1');
    expect(user?.userId).toBe('legacy-1');
    expect(user?.wallet).toBe(777);
    expect(user?.bank).toBe(3);
    const stored = await rawCol().findOne({ _id: 'legacy-1' });
    expect(stored?.['userId']).toBe('legacy-1');
  });

  it('repairs string balances and legacy flat inventory fields', async () => {
    await rawCol().insertOne({
      _id: 'legacy-2',
      wallet: '888',
      bank: '2',
      watch: 2,
      mobile: 0,
      laptop: 1,
    });
    const user = await repo.getUser('legacy-2');
    expect(user?.wallet).toBe(888);
    expect(user?.bank).toBe(2);
    expect(user?.inventory).toEqual([
      { itemId: 1, qty: 2 },
      { itemId: 3, qty: 1 },
    ]);
    const stored = await rawCol().findOne({ _id: 'legacy-2' });
    expect(stored?.['wallet']).toBe(888);
    expect(stored?.['watch']).toBeUndefined();
  });
});

describe('service.pay', () => {
  it('pays another user and refuses bots, self-pay, and overdraws', async () => {
    const payer = { id: 'payer', bot: false };
    const payee = { id: 'payee', bot: false };
    const result = await service.pay(payer, payee, '250');
    expect(result.amount).toBe(250);
    expect(await walletOf('payer')).toBe(4750);
    expect(await walletOf('payee')).toBe(5250);

    await expect(service.pay(payer, { id: 'robot', bot: true }, '1')).rejects.toThrow(/Bots/);
    await expect(service.pay(payer, payer, '1')).rejects.toBeInstanceOf(SelfTransferError);
    await expect(service.pay(payer, payee, '99999')).rejects.toBeInstanceOf(InsufficientFundsError);
    expect(await walletOf('payer')).toBe(4750);
  });
});

describe('service.robUser', () => {
  it('a full-band roll moves the whole amount and starts the cooldown', async () => {
    const lucky = new EconomyService(repo, () => 0.99);
    const robber = { id: 'robber', bot: false };
    const target = { id: 'victim', bot: false };
    const result = await lucky.robUser(robber, target, '1000');
    expect(result.outcome.kind).toBe('full');
    expect(await walletOf('robber')).toBe(6000);
    expect(await walletOf('victim')).toBe(4000);
    await expect(lucky.robUser(robber, target, '100')).rejects.toBeInstanceOf(RobCooldownError);
  });

  it('a caught roll fines the robber $1000 and leaves the target whole', async () => {
    const caught = new EconomyService(repo, () => 0.8);
    await caught.robUser({ id: 'robber', bot: false }, { id: 'victim', bot: false }, '1000');
    expect(await walletOf('robber')).toBe(4000);
    expect(await walletOf('victim')).toBe(5000);
  });

  it('the fine is clamped to the robber wallet — never negative (AUDIT §5.21)', async () => {
    const caught = new EconomyService(repo, () => 0.8);
    await repo.ensureUser('poor-robber');
    await repo.adjustWallet('poor-robber', -4500); // wallet now 500
    const result = await caught.robUser(
      { id: 'poor-robber', bot: false },
      { id: 'victim', bot: false },
      '100',
    );
    expect(result.fineApplied).toBe(500);
    expect(await walletOf('poor-robber')).toBe(0);
  });
});

describe('EconomyRepo — Phase 6 hardening', () => {
  it('credit at the safe-integer ceiling throws BalanceOverflowError and changes nothing', async () => {
    await repo.ensureUser('whale');
    await db
      .collection(ECONOMY_COLLECTION)
      .updateOne({ userId: 'whale' }, { $set: { wallet: Number.MAX_SAFE_INTEGER - 10 } });
    await expect(repo.credit('whale', 'wallet', 100)).rejects.toBeInstanceOf(BalanceOverflowError);
    expect(await walletOf('whale')).toBe(Number.MAX_SAFE_INTEGER - 10);
    // A transfer INTO the overflowing account aborts entirely.
    await repo.ensureUser('sender');
    await expect(repo.transfer('sender', 'whale', 100)).rejects.toBeInstanceOf(
      BalanceOverflowError,
    );
    expect(await walletOf('sender')).toBe(5000);
    expect(await walletOf('whale')).toBe(Number.MAX_SAFE_INTEGER - 10);
  });

  it('duplicate interaction ids settle a bet and a purchase exactly once', async () => {
    await repo.ensureUser('dup');
    const idem = { id: 'ix-dup-1', kind: 'coinflip', actorId: 'dup' };
    const first = await repo.settleBet('dup', 100, 100, idem);
    const second = await repo.settleBet('dup', 100, 100, idem);
    expect(first.wallet).toBe(5100);
    expect(second.wallet).toBe(5100);
    expect(await walletOf('dup')).toBe(5100);

    const laptop = itemById(3);
    if (laptop === undefined) throw new Error('laptop missing from shop');
    await repo.credit('dup', 'wallet', 20000); // fund the purchase: 5100 -> 25100
    const buyIdem = { id: 'ix-dup-2', kind: 'buy', actorId: 'dup' };
    await repo.purchase('dup', laptop, 1, buyIdem);
    const afterDup = await repo.purchase('dup', laptop, 1, buyIdem);
    expect(afterDup.inventory).toEqual([{ itemId: 3, qty: 1 }]);
    expect(await walletOf('dup')).toBe(25100 - buyPrice(laptop));
  });

  it('concurrent full-wallet bets: exactly one settles, wallet never negative', async () => {
    await repo.ensureUser('bettor'); // wallet 5000
    const results = await Promise.allSettled([
      repo.settleBet('bettor', 5000, -5000),
      repo.settleBet('bettor', 5000, -5000),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(await walletOf('bettor')).toBe(0);
  });

  // Phase 6c (R1) — SUPERSEDES the Phase 6 expectations in this test.
  // Phase 6 archived the record (keyed by _id, $setOnInsert) and then
  // let ensureUser create a FRESH account over it. GPT's re-audit
  // showed that silently orphans the real balance and discards later
  // quarantine evidence. Now: append-only events, the account FREEZES
  // until an operator resolves it, and resolution restores or
  // discards explicitly.
  it('a garbage record quarantines as an event and FREEZES the account until resolved (R1)', async () => {
    const garbageDoc = {
      _id: 'corrupt' as unknown as import('mongodb').ObjectId,
      userId: 'corrupt',
      wallet: 'not-a-number',
      bank: 10,
      inventory: [],
      lastDaily: null,
      lastWeekly: null,
      lastMonthly: null,
      lastRobbed: null,
    };
    await db.collection(ECONOMY_COLLECTION).insertOne(garbageDoc);
    expect(await repo.getUser('corrupt')).toBeNull();

    const quarantineCol = db.collection<import('mongodb').Document>('economy_quarantine');
    const events = await quarantineCol.find({ userId: 'corrupt' }).toArray();
    expect(events).toHaveLength(1);
    expect(events[0]?.['original']).toMatchObject({ wallet: 'not-a-number' });
    expect(events[0]?.['issues']).toEqual(expect.any(Array));
    expect(events[0]?.['resolvedAt']).toBeNull();

    // Frozen: no fresh account is created over the archived record,
    // and no money can move in either direction.
    await expect(repo.ensureUser('corrupt')).rejects.toBeInstanceOf(QuarantinedAccountError);
    await repo.ensureUser('funder');
    await expect(repo.transfer('funder', 'corrupt', 100)).rejects.toBeInstanceOf(
      QuarantinedAccountError,
    );
    expect(await walletOf('funder')).toBe(5000);
    expect(await repo.getUser('corrupt')).toBeNull();

    // A SECOND invalid record for the same account appends a second
    // event — the Phase 6 $setOnInsert archive discarded it.
    await db.collection(ECONOMY_COLLECTION).insertOne({ ...garbageDoc, wallet: 'also-garbage' });
    expect(await repo.getUser('corrupt')).toBeNull();
    const eventsAfter = await quarantineCol.find({ userId: 'corrupt' }).toArray();
    expect(eventsAfter).toHaveLength(2);
    expect(eventsAfter.map((e) => (e['original'] as { wallet: string }).wallet).sort()).toEqual([
      'also-garbage',
      'not-a-number',
    ]);

    // Operator resolution restores a corrected record and unfreezes.
    const corrected = {
      userId: 'corrupt',
      wallet: 1234,
      bank: 10,
      inventory: [],
      lastDaily: null,
      lastWeekly: null,
      lastMonthly: null,
      lastRobbed: null,
    };
    const resolution = await repo.resolveQuarantine('corrupt', corrected);
    expect(resolution.resolvedEvents).toBe(2);
    expect(resolution.user?.wallet).toBe(1234);
    expect(await repo.hasUnresolvedQuarantine('corrupt')).toBe(false);
    expect((await repo.ensureUser('corrupt')).wallet).toBe(1234);
  });

  it('quarantine resolution with null discards the record; the account then starts fresh (R1)', async () => {
    await db.collection(ECONOMY_COLLECTION).insertOne({
      _id: 'corrupt-discard' as unknown as import('mongodb').ObjectId,
      userId: 'corrupt-discard',
      wallet: 'garbage',
      bank: 0,
      inventory: [],
      lastDaily: null,
      lastWeekly: null,
      lastMonthly: null,
      lastRobbed: null,
    });
    expect(await repo.getUser('corrupt-discard')).toBeNull();
    await expect(repo.ensureUser('corrupt-discard')).rejects.toBeInstanceOf(
      QuarantinedAccountError,
    );
    const resolution = await repo.resolveQuarantine('corrupt-discard', null);
    expect(resolution.resolvedEvents).toBe(1);
    expect(resolution.user).toBeNull();
    expect((await repo.ensureUser('corrupt-discard')).wallet).toBe(5000);
  });

  it('repair runs inside a transaction: a concurrent transfer is never overwritten (P0-01)', async () => {
    // Legacy doc needing repair (string balances, flat inventory).
    await db.collection(ECONOMY_COLLECTION).insertOne({
      _id: 'legacy-race' as unknown as import('mongodb').ObjectId,
      wallet: '1000',
      bank: '0',
      watch: 1,
    });
    await repo.ensureUser('racer');
    const [repaired] = await Promise.all([
      repo.getUser('legacy-race'),
      repo.transfer('racer', 'legacy-race', 250),
      repo.transfer('legacy-race', 'racer', 100),
    ]);
    expect(repaired).not.toBeNull();
    // 1000 + 250 - 100 = 1150 regardless of interleaving.
    expect(await walletOf('legacy-race')).toBe(1150);
    expect((await repo.getUser('legacy-race'))?.inventory).toEqual([{ itemId: 1, qty: 1 }]);
  });

  it('addItem merges into one entry; selling the last unit leaves no tombstone (G10)', async () => {
    await repo.ensureUser('collector');
    await repo.addItem('collector', 1);
    await repo.addItem('collector', 1);
    expect((await repo.getUser('collector'))?.inventory).toEqual([{ itemId: 1, qty: 2 }]);
    const watch = itemById(1);
    if (watch === undefined) throw new Error('watch missing from shop');
    await repo.sellBack('collector', watch);
    expect((await repo.getUser('collector'))?.inventory).toEqual([{ itemId: 1, qty: 1 }]);
    await repo.sellBack('collector', watch);
    expect((await repo.getUser('collector'))?.inventory).toEqual([]);
  });

  it('adminRemove validates the amount at the service boundary (P3: negative must not credit)', async () => {
    await repo.ensureUser('victim');
    await expect(service.adminRemove({ id: 'victim', bot: false }, -500)).rejects.toBeInstanceOf(
      InvalidAmountError,
    );
    await expect(service.adminAdd({ id: 'victim', bot: false }, 0)).rejects.toBeInstanceOf(
      InvalidAmountError,
    );
    expect(await walletOf('victim')).toBe(5000);
  });

  it('rob via repo: caught fine clamps to the transactional wallet and stamps the cooldown once', async () => {
    await repo.ensureUser('robber-x');
    await repo.adjustWallet('robber-x', -4700); // wallet 300
    await repo.ensureUser('target-x');
    const { outcome, fineApplied } = await repo.rob('robber-x', 'target-x', 100, {
      band: 0.8, // caught band: [0.70, 0.95)
      fraction: 0,
    });
    expect(outcome.kind).toBe('caught');
    expect(fineApplied).toBe(300);
    expect(await walletOf('robber-x')).toBe(0);
    // Second attempt is on cooldown and consumes nothing.
    await expect(
      repo.rob('robber-x', 'target-x', 100, { band: 0.1, fraction: 0.5 }),
    ).rejects.toBeInstanceOf(RobCooldownError);
    expect(await walletOf('target-x')).toBe(5000);
  });
});

// Phase 6c (R2/R3 + the settleBet push P2): end-to-end receipts,
// inventory integer safety, and push-settlement stake coverage.
describe('EconomyRepo — Phase 6c corrective pass', () => {
  it('addItem refuses an increment that would pass the safe-integer ceiling (R2)', async () => {
    await repo.ensureUser('hoarder');
    await rawCol().updateOne(
      { userId: 'hoarder' },
      { $set: { inventory: [{ itemId: 1, qty: Number.MAX_SAFE_INTEGER }] } },
    );
    await expect(repo.addItem('hoarder', 1, 1)).rejects.toBeInstanceOf(InventoryOverflowError);
    expect((await repo.getUser('hoarder'))?.inventory).toEqual([
      { itemId: 1, qty: Number.MAX_SAFE_INTEGER },
    ]);
  });

  // GPT's exact R3 test: a full-wallet /pay succeeds; replaying the
  // same interaction afterwards must return the committed receipt,
  // NOT the insufficient-funds error a fresh validation produces.
  it('replaying a full-wallet /pay returns the committed receipt, not insufficient-funds (R3)', async () => {
    const payer = { id: 'r3-payer', bot: false };
    const payee = { id: 'r3-payee', bot: false };
    const first = await service.pay(payer, payee, 'all', 'ix-r3-pay-full');
    expect(first.amount).toBe(5000);
    expect(await walletOf('r3-payer')).toBe(0);
    expect(await walletOf('r3-payee')).toBe(10000);

    const replay = await service.pay(payer, payee, 'all', 'ix-r3-pay-full');
    expect(replay.amount).toBe(5000);
    expect(replay.fromUser.wallet).toBe(0);
    expect(replay.toUser.wallet).toBe(10000);
    expect(await walletOf('r3-payer')).toBe(0);
    expect(await walletOf('r3-payee')).toBe(10000);
  });

  // GPT's exact R3 game test: the RNG stub returns a DIFFERENT outcome
  // on its second invocation; the replay must still return the first
  // committed outcome (and must not consult the RNG again at all).
  it('replaying a game returns the committed outcome even when the RNG would reroll differently (R3)', async () => {
    let calls = 0;
    const shiftingRng = (): number => {
      calls += 1;
      return calls === 1 ? 0 : 0.99; // first roll: heads (win); later rolls: tails
    };
    const shifting = new EconomyService(repo, shiftingRng);
    const first = await shifting.playCoinflip('r3-gambler', '100', 'heads', 'ix-r3-flip');
    expect(first.outcome.won).toBe(true);
    expect(await walletOf('r3-gambler')).toBe(5100);
    const callsAfterFirst = calls;

    const replay = await shifting.playCoinflip('r3-gambler', '100', 'heads', 'ix-r3-flip');
    expect(replay.outcome).toEqual(first.outcome);
    expect(replay.bet).toBe(100);
    expect(replay.user.wallet).toBe(5100);
    expect(calls).toBe(callsAfterFirst); // the RNG was never reconsulted
    expect(await walletOf('r3-gambler')).toBe(5100);
  });

  it('a duplicate admin add applies exactly once (R3)', async () => {
    const target = { id: 'r3-mint', bot: false };
    // Phase 6e (R3): the invoking owner is passed as the ledger actor.
    const first = await service.adminAdd(target, 500, 'ix-r3-admin', 'owner-1');
    expect(first.wallet).toBe(5500);
    const replay = await service.adminAdd(target, 500, 'ix-r3-admin', 'owner-1');
    expect(replay.wallet).toBe(5500);
    expect(await walletOf('r3-mint')).toBe(5500);
  });

  it('replaying an all-in deposit returns the committed amount (R3)', async () => {
    await repo.ensureUser('r3-saver');
    const first = await service.deposit('r3-saver', 'all', 'ix-r3-deposit');
    expect(first.amount).toBe(5000);
    const replay = await service.deposit('r3-saver', 'all', 'ix-r3-deposit');
    expect(replay.amount).toBe(5000);
    const user = await repo.getUser('r3-saver');
    expect(user?.wallet).toBe(0);
    expect(user?.bank).toBe(5000);
  });

  it('the same interaction id with different parameters is a conflict, not a receipt (R3)', async () => {
    const payer = { id: 'r3-conflict', bot: false };
    const payee = { id: 'r3-conflict-payee', bot: false };
    await service.pay(payer, payee, '100', 'ix-r3-conflict');
    await expect(service.pay(payer, payee, '200', 'ix-r3-conflict')).rejects.toThrow(
      /already used for a different operation/,
    );
    expect(await walletOf('r3-conflict')).toBe(4900);
  });

  // Cheap P2 (GPT): settleBet's delta===0 (push) branch must verify
  // the wallet covers the stake — a push cannot settle a bet the user
  // could not have placed.
  it('a push settlement (delta 0) still verifies stake coverage', async () => {
    await repo.ensureUser('r3-push');
    const settled = await repo.settleBet('r3-push', 5000, 0);
    expect(settled.wallet).toBe(5000);
    await repo.adjustWallet('r3-push', -4500); // wallet now 500
    await expect(repo.settleBet('r3-push', 1000, 0)).rejects.toBeInstanceOf(InsufficientFundsError);
    expect(await walletOf('r3-push')).toBe(500);
  });
});

// Phase 6e (R1 + R3): GPT's targeted re-review found the freeze could
// be bypassed by a valid live record, the quarantine event was lost
// when the discovering financial transaction aborted, game/rob draws
// happened inside the retriable callback, and the admin ledger bound
// the target as its own actor.
describe('EconomyRepo — Phase 6e corrective pass', () => {
  const garbageFor = (userId: string): Record<string, unknown> => ({
    _id: userId,
    userId,
    wallet: 'not-a-number',
    bank: 10,
    inventory: [],
    lastDaily: null,
    lastWeekly: null,
    lastMonthly: null,
    lastRobbed: null,
  });

  // GPT's exact R1 durability case: NO preceding getUser() — the
  // corruption is discovered inside the transfer's own transaction,
  // which aborts on the freeze. Phase 6c lost the quarantine event to
  // that abort; the event must persist anyway, and no money may move.
  it('corruption discovered through an inbound transfer persists its quarantine event (R1)', async () => {
    await repo.ensureUser('r1e-sender');
    await db.collection(ECONOMY_COLLECTION).insertOne(garbageFor('r1e-victim'));

    await expect(repo.transfer('r1e-sender', 'r1e-victim', 100)).rejects.toBeInstanceOf(
      QuarantinedAccountError,
    );

    const quarantineCol = db.collection<import('mongodb').Document>('economy_quarantine');
    const events = await quarantineCol.find({ userId: 'r1e-victim' }).toArray();
    expect(events).toHaveLength(1);
    expect(events[0]?.['resolvedAt']).toBeNull();
    // The transfer did not apply, and the invalid record is gone.
    expect(await walletOf('r1e-sender')).toBe(5000);
    expect(await rawCol().findOne({ userId: 'r1e-victim' })).toBeNull();
  });

  // GPT's exact R1 bypass case: a VALID live record inserted while an
  // unresolved event exists must not un-freeze the account.
  it('a valid live record inserted during an unresolved quarantine does not unfreeze the account (R1)', async () => {
    await db.collection(ECONOMY_COLLECTION).insertOne(garbageFor('r1e-bypass'));
    expect(await repo.getUser('r1e-bypass')).toBeNull(); // quarantined; event unresolved
    await rawCol().insertOne({
      _id: 'r1e-bypass',
      userId: 'r1e-bypass',
      wallet: 777,
      bank: 0,
      inventory: [],
      lastDaily: null,
      lastWeekly: null,
      lastMonthly: null,
      lastRobbed: null,
    });

    await expect(repo.ensureUser('r1e-bypass')).rejects.toBeInstanceOf(QuarantinedAccountError);
    await repo.ensureUser('r1e-funder');
    await expect(repo.transfer('r1e-funder', 'r1e-bypass', 100)).rejects.toBeInstanceOf(
      QuarantinedAccountError,
    );
    await expect(repo.transfer('r1e-bypass', 'r1e-funder', 100)).rejects.toBeInstanceOf(
      QuarantinedAccountError,
    );
    await expect(repo.settleBet('r1e-bypass', 100, 100)).rejects.toBeInstanceOf(
      QuarantinedAccountError,
    );
    // Nothing moved: the reinserted record and the funder are intact.
    expect((await rawCol().findOne({ userId: 'r1e-bypass' }))?.['wallet']).toBe(777);
    expect(await walletOf('r1e-funder')).toBe(5000);
  });

  // GPT's required R3 case: force a transient transaction error after
  // the first draw — the retry must settle ONCE with the ORIGINAL
  // draw. The stub makes the first settleBetInTxn call throw a
  // TransientTransactionError-labeled MongoError, so withTransaction
  // retries the op; the RNG would return 0.99 (a loss) if consulted
  // again.
  it('a transient transaction error retries the game with the ORIGINAL draw (R3)', async () => {
    let rngCalls = 0;
    const shiftingRng = (): number => {
      rngCalls += 1;
      return rngCalls === 1 ? 0 : 0.99; // first draw: heads (win); later: tails
    };
    const flaky = new EconomyService(repo, shiftingRng);
    const original = repo.settleBetInTxn.bind(repo);
    let settleCalls = 0;
    repo.settleBetInTxn = async (session, userId, bet, delta) => {
      settleCalls += 1;
      if (settleCalls === 1) {
        const transient = new MongoError('simulated transient transaction failure');
        transient.addErrorLabel('TransientTransactionError');
        throw transient;
      }
      return original(session, userId, bet, delta);
    };
    try {
      const result = await flaky.playCoinflip('r3-flaky', '100', 'heads', 'ix-r3-flaky');
      expect(result.outcome.won).toBe(true); // the ORIGINAL draw (0 = heads)
      expect(result.user.wallet).toBe(5100);
      expect(settleCalls).toBe(2); // one failed attempt + one retry
      expect(rngCalls).toBe(1); // the RNG was consulted exactly once
      expect(await walletOf('r3-flaky')).toBe(5100); // settled exactly once
    } finally {
      repo.settleBetInTxn = original;
    }
  });

  // The rob mirror: band/fraction are drawn before the callback, so a
  // transient retry settles with the original rolls (partial steal of
  // 50), not the re-drawn 0.9s (which would land in a later band).
  it('a transient transaction error retries the rob with the ORIGINAL rolls (R3)', async () => {
    const sequence = [0.1, 0.5];
    let rngCalls = 0;
    const seqRng = (): number => {
      const value = sequence[rngCalls] ?? 0.9;
      rngCalls += 1;
      return value;
    };
    const flaky = new EconomyService(repo, seqRng);
    await repo.ensureUser('r3-robber');
    await repo.ensureUser('r3-rob-victim');
    const original = repo.robInTxn.bind(repo);
    let robCalls = 0;
    repo.robInTxn = async (session, robberId, targetId, amount, rolls, now) => {
      robCalls += 1;
      if (robCalls === 1) {
        const transient = new MongoError('simulated transient transaction failure');
        transient.addErrorLabel('TransientTransactionError');
        throw transient;
      }
      return original(session, robberId, targetId, amount, rolls, now);
    };
    try {
      const result = await flaky.robUser(
        { id: 'r3-robber', bot: false },
        { id: 'r3-rob-victim', bot: false },
        '100',
        'ix-r3-rob-flaky',
      );
      expect(result.outcome.kind).toBe('partial'); // band 0.1, fraction 0.5
      expect(result.outcome.stolen).toBe(50);
      expect(robCalls).toBe(2);
      expect(rngCalls).toBe(2); // band + fraction, drawn exactly once each
      expect(await walletOf('r3-robber')).toBe(5050);
      expect(await walletOf('r3-rob-victim')).toBe(4950);
    } finally {
      repo.robInTxn = original;
    }
  });

  // GPT's R3 binding case: the admin ledger records WHO acted (the
  // invoking owner), with the target bound in params.
  it('the admin ledger binds the invoking owner as actor and the target in params (R3)', async () => {
    const target = { id: 'r3-bound', bot: false };
    await service.adminAdd(target, 500, 'ix-r3-bind', 'owner-9');
    const doc = await db
      .collection<import('mongodb').Document>('economy_idempotency')
      .findOne({ _id: 'ix-r3-bind' as never });
    expect(doc?.['actorId']).toBe('owner-9');
    expect(doc?.['params']).toEqual({ targetId: 'r3-bound', amount: 500 });
  });
});

// Phase 6g (R1): GPT's final confirmation found a stale-snapshot race
// in the Phase 6e restructure. persistQuarantine archived and deleted
// using the document captured by the ABORTED discovering transaction,
// keyed only by _id — so a persistence delayed past another flow's
// quarantine AND an operator's restore would archive the stale
// snapshot and delete the operator's corrected account.
describe('EconomyRepo — Phase 6g corrective pass', () => {
  const garbageFor = (userId: string): Record<string, unknown> => ({
    _id: userId,
    userId,
    wallet: 'not-a-number',
    bank: 10,
    inventory: [],
    lastDaily: null,
    lastWeekly: null,
    lastMonthly: null,
    lastRobbed: null,
  });

  // GPT's exact interleaving: txn A discovers the corruption and
  // aborts, but its persistQuarantine is DELAYED; meanwhile a second
  // flow quarantines the account and an operator resolves the
  // quarantine, restoring a corrected balance. When the delayed
  // persistence finally runs, the corrected account must SURVIVE, no
  // new quarantine event may be added, and the original operation
  // must still surface QuarantinedAccountError.
  it('a delayed quarantine persistence cannot delete an operator-restored account (R1)', async () => {
    const userId = 'r1g-race';
    await repo.ensureUser('r1g-sender');
    await db.collection(ECONOMY_COLLECTION).insertOne(garbageFor(userId));

    // Hold the persistence step open: capture the discovery when the
    // aborted transfer's boundary tries to persist it, and do not let
    // the real persistence run until the test releases the gate.
    interface RepoInternals {
      persistQuarantine: (discovery: unknown) => Promise<void>;
    }
    const internals = repo as unknown as RepoInternals;
    const realPersist = internals.persistQuarantine.bind(repo);
    let signalCaptured!: () => void;
    const captured = new Promise<void>((resolve) => {
      signalCaptured = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    internals.persistQuarantine = async (discovery: unknown) => {
      signalCaptured();
      await gate;
      return realPersist(discovery);
    };

    try {
      const outcome = repo.transfer('r1g-sender', userId, 100).then(
        () => null,
        (error: unknown) => error,
      );
      // The transfer has discovered the corruption and aborted; its
      // persistence is now parked at the gate.
      await captured;

      // Second flow: an ordinary read quarantines the still-live
      // corrupt record (event #1), then the operator resolves the
      // quarantine and restores a corrected balance.
      expect(await repo.getUser(userId)).toBeNull();
      const corrected = {
        userId,
        wallet: 4321,
        bank: 10,
        inventory: [],
        lastDaily: null,
        lastWeekly: null,
        lastMonthly: null,
        lastRobbed: null,
      };
      const resolution = await repo.resolveQuarantine(userId, corrected);
      expect(resolution.resolvedEvents).toBe(1);
      expect((await repo.getUser(userId))?.wallet).toBe(4321);

      // Release the delayed persistence from transaction A.
      release();
      const error = await outcome;
      // The original operation still surfaced the freeze…
      expect(error).toBeInstanceOf(QuarantinedAccountError);
      // …but the corrected account and its balance SURVIVED…
      expect((await rawCol().findOne({ userId }))?.['wallet']).toBe(4321);
      expect((await repo.getUser(userId))?.wallet).toBe(4321);
      expect(await walletOf('r1g-sender')).toBe(5000);
      // …and the stale persistence added NO new quarantine event.
      const quarantineCol = db.collection<import('mongodb').Document>('economy_quarantine');
      const events = await quarantineCol.find({ userId }).toArray();
      expect(events).toHaveLength(1);
      expect(events[0]?.['resolvedAt']).not.toBeNull();
      expect(await repo.hasUnresolvedQuarantine(userId)).toBe(false);
    } finally {
      internals.persistQuarantine = realPersist;
    }
  });
});

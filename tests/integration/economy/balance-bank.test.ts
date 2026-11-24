import type { ChatInputCommandInteraction } from 'discord.js';
import { MongoClient, type Db } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { ensureIndexes } from '../../../src/db/indexes.js';
import { balanceCommand } from '../../../src/features/economy/commands/balance.js';
import { bankCommand } from '../../../src/features/economy/commands/bank.js';
import { EconomyRepo } from '../../../src/features/economy/economy.repo.js';
import { ECONOMY_COLLECTION } from '../../../src/features/economy/types.js';
import { makeCtx } from '../../fixtures/fakes.js';

/**
 * Phase 6e (R2): net worth must be exact at the presentation layer.
 * Wallet and bank are individually capped at MAX_SAFE_INTEGER, so
 * their sum can exceed the safe range — /balance and /bank added them
 * as JS numbers, and MAX_SAFE_INTEGER + 2 rendered …992 instead of
 * …993 (GPT's executed case). Both commands now format the BigInt
 * netWorth() helper.
 */

let client: MongoClient;
let db: Db;
let repo: EconomyRepo;

beforeAll(async () => {
  client = new MongoClient(inject('mongoUri'));
  await client.connect();
  db = client.db('cutiebot-test-balance-bank');
  await ensureIndexes(db);
  repo = new EconomyRepo({ client, db });
}, 300_000);

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await db.collection(ECONOMY_COLLECTION).deleteMany({});
});

interface FakeUser {
  id: string;
  bot: boolean;
  username: string;
  displayAvatarURL: () => string;
}

function fakeUser(id: string): FakeUser {
  return { id, bot: false, username: `user-${id}`, displayAvatarURL: () => 'https://x/a.png' };
}

interface RecordedFollowUp {
  embeds?: Array<{ toJSON: () => Record<string, unknown> }>;
}

function fakeInteraction(user: FakeUser) {
  const followUps: RecordedFollowUp[] = [];
  const interaction = {
    id: `interaction-${user.id}`,
    guildId: 'guild-1',
    user,
    memberPermissions: null,
    replied: false,
    deferred: false,
    options: {
      getUser: () => null,
    },
    deferReply: async () => {
      interaction.deferred = true;
    },
    editReply: async (payload: RecordedFollowUp) => {
      followUps.push(payload);
      return {};
    },
  };
  return { interaction, followUps };
}

describe('/balance and /bank net worth (Phase 6e, R2)', () => {
  it('renders MAX_SAFE_INTEGER wallet + 2 bank as …993 in /balance and /bank', async () => {
    await repo.ensureUser('whale');
    await db
      .collection(ECONOMY_COLLECTION)
      .updateOne({ _id: 'whale' as never }, { $set: { wallet: Number.MAX_SAFE_INTEGER, bank: 2 } });
    const ctx = makeCtx({ db: { client, db } });

    const balance = fakeInteraction(fakeUser('whale'));
    await balanceCommand.execute(
      ctx,
      balance.interaction as unknown as ChatInputCommandInteraction,
    );
    const balanceJson = balance.followUps[0]?.embeds?.[0]?.toJSON() ?? {};
    expect(balanceJson['description']).toContain('Net: $ 9,007,199,254,740,993');
    expect(balanceJson['description']).not.toContain('9,007,199,254,740,992');

    const bank = fakeInteraction(fakeUser('whale'));
    await bankCommand.execute(ctx, bank.interaction as unknown as ChatInputCommandInteraction);
    const bankJson = bank.followUps[0]?.embeds?.[0]?.toJSON() ?? {};
    const fields = (bankJson['fields'] ?? []) as Array<{ name: string; value: string }>;
    const netWorthField = fields.find((field) => field.name === 'Net Worth');
    expect(netWorthField?.value).toBe('$ 9,007,199,254,740,993');
  });
});

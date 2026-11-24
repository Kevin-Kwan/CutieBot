import type { ChatInputCommandInteraction } from 'discord.js';
import { MongoClient, type Db } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { ensureIndexes } from '../../../src/db/indexes.js';
import { EconomyRepo } from '../../../src/features/economy/economy.repo.js';
import { payCommand } from '../../../src/features/economy/commands/pay.js';
import { ECONOMY_COLLECTION } from '../../../src/features/economy/types.js';
import { makeCtx } from '../../fixtures/fakes.js';

/**
 * Drives the REAL /pay command module end-to-end: fabricated interaction →
 * command execute → EconomyService → EconomyRepo → replica-set MongoDB.
 * The money path is never faked (per the Phase 2 spec).
 */

let client: MongoClient;
let db: Db;
let repo: EconomyRepo;

beforeAll(async () => {
  // Shared replica set from tests/global-setup.ts (Phase 6, G9).
  client = new MongoClient(inject('mongoUri'));
  await client.connect();
  db = client.db('cutiebot-test-pay');
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

function fakeUser(id: string, bot = false): FakeUser {
  return { id, bot, username: `user-${id}`, displayAvatarURL: () => 'https://example.com/a.png' };
}

interface RecordedFollowUp {
  embeds?: Array<{ toJSON: () => Record<string, unknown> }>;
}

let interactionSeq = 0;

/** A fabricated chat-input interaction wired to the /pay options. */
function fakePayInteraction(
  payer: FakeUser,
  payee: FakeUser,
  amount: string,
  interactionId = `interaction-pay-${++interactionSeq}`,
) {
  const followUps: RecordedFollowUp[] = [];
  const interaction = {
    id: interactionId,
    commandName: 'pay',
    guildId: 'guild-1',
    user: payer,
    memberPermissions: null,
    replied: false,
    deferred: false,
    options: {
      getUser: (name: string) => (name === 'member' ? payee : null),
      getString: (name: string) => (name === 'amount' ? amount : null),
    },
    deferReply: async () => {
      interaction.deferred = true;
    },
    // Phase 6 (G14): runEconomy answers via editReply now.
    editReply: async (payload: RecordedFollowUp) => {
      followUps.push(payload);
      return {};
    },
  };
  return { interaction, followUps };
}

function embedTitles(followUps: readonly RecordedFollowUp[]): unknown[] {
  return followUps.flatMap((followUp) =>
    (followUp.embeds ?? []).map((embed) => embed.toJSON()['title']),
  );
}

describe('/pay command (integration, replica-set backed)', () => {
  it('executes a payment end-to-end and reports success', async () => {
    const ctx = makeCtx({ db: { client, db } });
    const { interaction, followUps } = fakePayInteraction(
      fakeUser('payer'),
      fakeUser('payee'),
      '250',
    );
    await payCommand.execute(ctx, interaction as unknown as ChatInputCommandInteraction);

    expect(embedTitles(followUps)).toContain('Payment Successful');
    expect((await repo.getUser('payer'))?.wallet).toBe(4750);
    expect((await repo.getUser('payee'))?.wallet).toBe(5250);
  });

  it('an overdraw attempt surfaces an error embed and moves nothing', async () => {
    const ctx = makeCtx({ db: { client, db } });
    const { interaction, followUps } = fakePayInteraction(
      fakeUser('payer'),
      fakeUser('payee'),
      '99999',
    );
    await payCommand.execute(ctx, interaction as unknown as ChatInputCommandInteraction);

    expect(embedTitles(followUps)).toContain('Error');
    expect((await repo.getUser('payer'))?.wallet).toBe(5000);
    // The payee account was never even created by the failed payment.
    expect(await repo.getUser('payee')).toBeNull();
  });

  it('paying a bot surfaces an error embed and moves nothing', async () => {
    const ctx = makeCtx({ db: { client, db } });
    const { interaction, followUps } = fakePayInteraction(
      fakeUser('payer'),
      fakeUser('robot', true),
      '100',
    );
    await payCommand.execute(ctx, interaction as unknown as ChatInputCommandInteraction);

    expect(embedTitles(followUps)).toContain('Error');
    // The bot check fires before any account is created or money moves.
    expect(await repo.getUser('payer')).toBeNull();
    expect(await repo.getUser('robot')).toBeNull();
  });

  // Phase 6 (P1-01/G3): the same interaction delivered twice (Discord
  // redelivery, gateway retry) must move money exactly once — the
  // second execution replays the stored result from the ledger.
  it('a duplicated interaction id moves money once and still reports success', async () => {
    const ctx = makeCtx({ db: { client, db } });
    const first = fakePayInteraction(
      fakeUser('payer'),
      fakeUser('payee'),
      '250',
      'interaction-dup',
    );
    await payCommand.execute(ctx, first.interaction as unknown as ChatInputCommandInteraction);
    const second = fakePayInteraction(
      fakeUser('payer'),
      fakeUser('payee'),
      '250',
      'interaction-dup',
    );
    await payCommand.execute(ctx, second.interaction as unknown as ChatInputCommandInteraction);

    expect(embedTitles(first.followUps)).toContain('Payment Successful');
    expect(embedTitles(second.followUps)).toContain('Payment Successful');
    expect((await repo.getUser('payer'))?.wallet).toBe(4750);
    expect((await repo.getUser('payee'))?.wallet).toBe(5250);
  });
});

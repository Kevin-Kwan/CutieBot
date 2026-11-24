import {
  ApplicationCommandOptionType,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { describe, expect, it } from 'vitest';
import type { AppContext } from '../../../src/core/context.js';
import { banCommand } from '../../../src/features/moderation/commands/ban.js';
import { kickCommand } from '../../../src/features/moderation/commands/kick.js';
import { timeoutCommand } from '../../../src/features/moderation/commands/timeout.js';
import { unbanCommand } from '../../../src/features/moderation/commands/unban.js';
import { makeCtx as makeBaseCtx } from '../../fixtures/fakes.js';
import {
  FakeGuild,
  FakeInteraction,
  FakeMember,
  capturingLogger,
  discordApiError,
  fakeUser,
} from '../../fixtures/moderation.js';

const ALL_MOD_PERMS =
  PermissionFlagsBits.BanMembers |
  PermissionFlagsBits.KickMembers |
  PermissionFlagsBits.ModerateMembers;

const OWNER_ID = 'owner-1';
const BOT_ID = 'bot-1';
const MOD_ID = 'mod-1';
const TARGET_ID = 'target-1';

interface Harness {
  guild: FakeGuild;
  invoker: FakeMember;
  target: FakeMember;
  ctx: AppContext;
  logEntries: () => Record<string, unknown>[];
}

function harness(
  targetOptions: {
    rolePosition?: number;
    permissions?: bigint;
    communicationDisabled?: boolean;
  } = {},
): Harness {
  const bot = new FakeMember({ id: BOT_ID, rolePosition: 20, permissions: ALL_MOD_PERMS });
  const invoker = new FakeMember({ id: MOD_ID, rolePosition: 10, permissions: ALL_MOD_PERMS });
  const target = new FakeMember({
    id: TARGET_ID,
    rolePosition: targetOptions.rolePosition ?? 5,
    permissions: targetOptions.permissions ?? 0n,
    communicationDisabled: targetOptions.communicationDisabled ?? false,
  });
  const guild = new FakeGuild(OWNER_ID, bot, [bot, invoker, target]);
  const { logger, entries } = capturingLogger();
  const ctx = makeBaseCtx({ logger });
  return { guild, invoker, target, ctx, logEntries: entries };
}

function interaction(
  guild: FakeGuild,
  spec: Partial<ConstructorParameters<typeof FakeInteraction>[0]> = {},
): FakeInteraction {
  return new FakeInteraction({
    user: fakeUser(MOD_ID),
    guild,
    member: guild.member(MOD_ID) ?? null,
    optionUser: fakeUser(TARGET_ID),
    ...spec,
  });
}

function asInteraction(fake: FakeInteraction): ChatInputCommandInteraction {
  return fake as unknown as ChatInputCommandInteraction;
}

function moderationLogs(entries: Record<string, unknown>[]): Record<string, unknown>[] {
  return entries.filter(
    (entry) =>
      entry['msg'] === 'Moderation action completed' || entry['msg'] === 'Moderation action denied',
  );
}

describe('/unban payload shape', () => {
  it('declares user_id as a required STRING option (not a user option)', () => {
    const json = unbanCommand.data.toJSON() as {
      options?: { name: string; type: number; required?: boolean }[];
    };
    const userId = json.options?.find((option) => option.name === 'user_id');
    expect(userId).toBeDefined();
    expect(userId?.type).toBe(ApplicationCommandOptionType.String);
    expect(userId?.required).toBe(true);
    // The draft bug: a user option named 'user' alongside the user_id read.
    expect(json.options?.some((option) => option.name === 'user')).toBe(false);
  });
});

describe('/unban regression — unban must never ban', () => {
  it('calls guild.bans.remove and never any ban path', async () => {
    const { guild, ctx, logEntries } = harness();
    const fake = interaction(guild, {
      commandName: 'unban',
      strings: { user_id: '123456789012345678', reason: 'appeal accepted' },
    });

    await unbanCommand.execute(ctx, asInteraction(fake));

    expect(guild.banRemoveCalls).toEqual([{ id: '123456789012345678', reason: 'appeal accepted' }]);
    expect(guild.banCreateCalls).toHaveLength(0);
    expect(guild.memberBanCalls).toHaveLength(0);
    expect(fake.lastEmbed()?.['title']).toBe('User unbanned');

    const logs = moderationLogs(logEntries());
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      action: 'unban',
      outcome: 'success',
      actorId: MOD_ID,
      targetId: '123456789012345678',
      guildId: 'guild-1',
      reason: 'appeal accepted',
    });
  });

  it('reports "not banned" on Unknown Ban and still never bans', async () => {
    const { guild, ctx, logEntries } = harness();
    guild.banRemoveError = discordApiError(RESTJSONErrorCodes.UnknownBan, 'Unknown Ban');
    const fake = interaction(guild, {
      commandName: 'unban',
      strings: { user_id: '123456789012345678', reason: null },
    });

    await unbanCommand.execute(ctx, asInteraction(fake));

    expect(guild.banRemoveCalls).toHaveLength(1);
    expect(guild.banCreateCalls).toHaveLength(0);
    expect(guild.memberBanCalls).toHaveLength(0);
    expect(fake.lastEmbed()?.['description']).toBe('That user is not banned.');
    expect(moderationLogs(logEntries())[0]).toMatchObject({
      action: 'unban',
      outcome: 'denied',
      detail: 'not-banned',
    });
  });

  it('rejects malformed user IDs before touching the API', async () => {
    const { guild, ctx, logEntries } = harness();
    for (const bad of ['abc', '0', '12345678901234567890123', '12 34']) {
      const fake = interaction(guild, {
        commandName: 'unban',
        strings: { user_id: bad, reason: null },
      });
      await unbanCommand.execute(ctx, asInteraction(fake));
      expect(fake.lastEmbed()?.['description']).toBe('Please provide a valid Discord user ID.');
    }
    expect(guild.banRemoveCalls).toHaveLength(0);
    expect(guild.banCreateCalls).toHaveLength(0);
    const denied = moderationLogs(logEntries()).filter((entry) => entry['outcome'] === 'denied');
    expect(denied).toHaveLength(4);
    expect(denied[0]).toMatchObject({ action: 'unban', detail: 'invalid-user-id' });
  });
});

describe('/ban', () => {
  it('bans a member through guild.members.ban with delete-seconds and reason', async () => {
    const { guild, ctx, logEntries } = harness();
    const fake = interaction(guild, {
      commandName: 'ban',
      strings: { reason: 'spam' },
      integers: { delete_messages: 1 },
    });

    await banCommand.execute(ctx, asInteraction(fake));

    expect(guild.memberBanCalls).toEqual([
      { id: TARGET_ID, options: { deleteMessageSeconds: 86_400, reason: 'spam' } },
    ]);
    expect(guild.banCreateCalls).toHaveLength(0);
    expect(fake.lastEmbed()?.['title']).toBe('User banned');
    expect(moderationLogs(logEntries())[0]).toMatchObject({
      action: 'ban',
      outcome: 'success',
      actorId: MOD_ID,
      targetId: TARGET_ID,
      guildId: 'guild-1',
      reason: 'spam',
    });
  });

  it('guard-denied: a target above the bot is never banned and the denial is logged', async () => {
    const { guild, ctx, logEntries } = harness({ rolePosition: 50 });
    const fake = interaction(guild, {
      commandName: 'ban',
      strings: { reason: 'trying' },
      integers: { delete_messages: 0 },
    });

    await banCommand.execute(ctx, asInteraction(fake));

    expect(guild.memberBanCalls).toHaveLength(0);
    expect(guild.banCreateCalls).toHaveLength(0);
    expect(fake.lastEmbed()?.['description']).toBe(
      'You can only moderate members whose highest role is below yours.',
    );
    expect(moderationLogs(logEntries())[0]).toMatchObject({
      action: 'ban',
      outcome: 'denied',
      actorId: MOD_ID,
      targetId: TARGET_ID,
      guildId: 'guild-1',
      reason: 'trying',
    });
  });

  it('bans a non-member by ID through guild.bans.create', async () => {
    const { guild, ctx, logEntries } = harness();
    const fake = interaction(guild, {
      commandName: 'ban',
      optionUser: fakeUser('outsider-1'),
      strings: { reason: 'raid' },
      integers: { delete_messages: 0 },
    });

    await banCommand.execute(ctx, asInteraction(fake));

    expect(guild.banCreateCalls).toEqual([
      { id: 'outsider-1', options: { deleteMessageSeconds: 0, reason: 'raid' } },
    ]);
    expect(guild.memberBanCalls).toHaveLength(0);
    expect(fake.lastEmbed()?.['title']).toBe('User banned');
    expect(moderationLogs(logEntries())[0]).toMatchObject({
      action: 'ban',
      outcome: 'success',
      targetId: 'outsider-1',
    });
  });

  // Phase 6 (P2-06): the non-member path rechecks the invoker's
  // permission FRESH — a BanMembers revoked after the router's check
  // must stop the ban from landing.
  it('refuses a non-member ban when the invoker permission was revoked mid-flight', async () => {
    const { guild, invoker, ctx, logEntries } = harness();
    invoker.permissions.remove(PermissionFlagsBits.BanMembers);
    const fake = interaction(guild, {
      commandName: 'ban',
      optionUser: fakeUser('outsider-3'),
      strings: { reason: 'raid' },
      integers: { delete_messages: 0 },
    });

    await banCommand.execute(ctx, asInteraction(fake));

    expect(guild.banCreateCalls).toHaveLength(0);
    expect(moderationLogs(logEntries())[0]).toMatchObject({
      action: 'ban',
      outcome: 'denied',
      detail: 'invoker-permission-revoked',
    });
  });

  // Phase 6 (P2-07): validation refusals are audit-logged too.
  it('logs a denial for an invalid delete_messages value', async () => {
    const { guild, ctx, logEntries } = harness();
    const fake = interaction(guild, {
      commandName: 'ban',
      strings: { reason: null },
      integers: { delete_messages: 9 },
    });

    await banCommand.execute(ctx, asInteraction(fake));

    expect(guild.banCreateCalls).toHaveLength(0);
    expect(guild.memberBanCalls).toHaveLength(0);
    expect(moderationLogs(logEntries())[0]).toMatchObject({
      action: 'ban',
      outcome: 'denied',
      detail: 'invalid-delete-days',
    });
  });
});

describe('/kick', () => {
  it('kicks the member and logs the action', async () => {
    const { guild, target, ctx, logEntries } = harness();
    const fake = interaction(guild, {
      commandName: 'kick',
      strings: { reason: 'idle' },
    });

    await kickCommand.execute(ctx, asInteraction(fake));

    expect(target.kickCalls).toEqual(['idle']);
    expect(fake.lastEmbed()?.['title']).toBe('Member kicked');
    expect(moderationLogs(logEntries())[0]).toMatchObject({
      action: 'kick',
      outcome: 'success',
      actorId: MOD_ID,
      targetId: TARGET_ID,
      reason: 'idle',
    });
  });

  it('refuses to kick a non-member', async () => {
    const { guild, ctx } = harness();
    const fake = interaction(guild, {
      commandName: 'kick',
      optionUser: fakeUser('outsider-2'),
      strings: { reason: null },
    });

    await kickCommand.execute(ctx, asInteraction(fake));

    expect(fake.lastEmbed()?.['description']).toBe('That user is not a member of this server.');
  });
});

describe('/timeout', () => {
  it('applies a parsed duration and logs timeout.apply', async () => {
    const { guild, target, ctx, logEntries } = harness();
    const fake = interaction(guild, {
      commandName: 'timeout',
      strings: { duration: '10m', reason: 'caps' },
      booleans: { remove: false },
    });

    await timeoutCommand.execute(ctx, asInteraction(fake));

    expect(target.timeoutCalls).toEqual([{ duration: 600_000, reason: 'caps' }]);
    expect(fake.lastEmbed()?.['title']).toBe('Member timed out');
    expect(moderationLogs(logEntries())[0]).toMatchObject({
      action: 'timeout.apply',
      outcome: 'success',
      targetId: TARGET_ID,
      reason: 'caps',
    });
  });

  it('denies timing out an Administrator and logs the denial', async () => {
    const { guild, target, ctx, logEntries } = harness({
      permissions: PermissionFlagsBits.Administrator,
    });
    const fake = interaction(guild, {
      commandName: 'timeout',
      strings: { duration: '10m', reason: null },
      booleans: { remove: false },
    });

    await timeoutCommand.execute(ctx, asInteraction(fake));

    expect(target.timeoutCalls).toHaveLength(0);
    expect(fake.lastEmbed()?.['description']).toBe(
      'Members with the Administrator permission cannot be timed out.',
    );
    expect(moderationLogs(logEntries())[0]).toMatchObject({
      action: 'timeout.apply',
      outcome: 'denied',
      detail: 'administrator-target',
    });
  });

  // Phase 6 (P2-07): contradictory options are audit-logged as denied.
  it('logs a denial for contradictory duration + remove options', async () => {
    const { guild, target, ctx, logEntries } = harness();
    const fake = interaction(guild, {
      commandName: 'timeout',
      strings: { duration: '10m', reason: null },
      booleans: { remove: true },
    });

    await timeoutCommand.execute(ctx, asInteraction(fake));

    expect(target.timeoutCalls).toHaveLength(0);
    expect(moderationLogs(logEntries())[0]).toMatchObject({
      action: 'timeout.remove',
      outcome: 'denied',
      detail: 'contradictory-options',
    });
  });

  it('rejects an unparseable duration before any API call', async () => {
    const { guild, target, ctx } = harness();
    const fake = interaction(guild, {
      commandName: 'timeout',
      strings: { duration: 'a while', reason: null },
      booleans: { remove: false },
    });

    await timeoutCommand.execute(ctx, asInteraction(fake));

    expect(target.timeoutCalls).toHaveLength(0);
    expect(fake.lastEmbed()?.['description']).toMatch(/Invalid duration/);
  });

  it('removes an active timeout and logs timeout.remove', async () => {
    const { guild, target, ctx, logEntries } = harness({ communicationDisabled: true });
    const fake = interaction(guild, {
      commandName: 'timeout',
      strings: { duration: null, reason: 'cooled off' },
      booleans: { remove: true },
    });

    await timeoutCommand.execute(ctx, asInteraction(fake));

    expect(target.timeoutCalls).toEqual([{ duration: null, reason: 'cooled off' }]);
    expect(fake.lastEmbed()?.['title']).toBe('Timeout removed');
    expect(moderationLogs(logEntries())[0]).toMatchObject({
      action: 'timeout.remove',
      outcome: 'success',
    });
  });

  it('reports when there is no active timeout to remove', async () => {
    const { guild, target, ctx } = harness({ communicationDisabled: false });
    const fake = interaction(guild, {
      commandName: 'timeout',
      strings: { duration: null, reason: null },
      booleans: { remove: true },
    });

    await timeoutCommand.execute(ctx, asInteraction(fake));

    expect(target.timeoutCalls).toHaveLength(0);
    expect(fake.lastEmbed()?.['description']).toBe(
      'That member does not currently have an active timeout.',
    );
  });
});

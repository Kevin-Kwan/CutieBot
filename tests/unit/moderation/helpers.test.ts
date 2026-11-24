import {
  PermissionFlagsBits,
  RESTJSONErrorCodes,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
} from 'discord.js';
import { describe, expect, it } from 'vitest';
import { makeCtx } from '../../fixtures/fakes.js';
import {
  FakeGuild,
  FakeInteraction,
  FakeMember,
  discordApiError,
  fakeUser,
} from '../../fixtures/moderation.js';
import {
  confirmSuccess,
  fetchTargetMember,
  guardBotPermission,
  guardModeration,
} from '../../../src/features/moderation/helpers.js';
import { successEmbed } from '../../../src/shared/embeds.js';
import { capturingLogger } from '../../fixtures/moderation.js';

const ALL_MOD_PERMS =
  PermissionFlagsBits.BanMembers |
  PermissionFlagsBits.KickMembers |
  PermissionFlagsBits.ModerateMembers;

const OWNER_ID = 'owner-1';
const BOT_ID = 'bot-1';
const MOD_ID = 'mod-1';

interface Harness {
  guild: FakeGuild;
  bot: FakeMember;
  invoker: FakeMember;
}

function harness(
  overrides: {
    botPermissions?: bigint;
    invokerPermissions?: bigint;
    invokerPosition?: number;
    invokerId?: string;
  } = {},
): Harness {
  const bot = new FakeMember({
    id: BOT_ID,
    rolePosition: 20,
    permissions: overrides.botPermissions ?? ALL_MOD_PERMS,
  });
  const invoker = new FakeMember({
    id: overrides.invokerId ?? MOD_ID,
    rolePosition: overrides.invokerPosition ?? 10,
    permissions: overrides.invokerPermissions ?? ALL_MOD_PERMS,
  });
  const guild = new FakeGuild(OWNER_ID, bot, [bot, invoker]);
  return { guild, bot, invoker };
}

function interactionFor(guild: FakeGuild, invoker: FakeMember): FakeInteraction {
  return new FakeInteraction({
    user: fakeUser(invoker.id),
    guild,
    member: invoker,
  });
}

async function guard(
  guild: FakeGuild,
  interaction: FakeInteraction,
  target: FakeMember,
): Promise<boolean> {
  return guardModeration(
    makeCtx(),
    interaction as unknown as ChatInputCommandInteraction,
    target as unknown as GuildMember,
    PermissionFlagsBits.BanMembers,
    'Ban Members',
  );
}

function addMember(guild: FakeGuild, member: FakeMember): FakeMember {
  return guild.register(member);
}

describe('guardModeration — hierarchy matrix', () => {
  it('allows a target below both invoker and bot', async () => {
    const { guild, invoker } = harness();
    const target = addMember(guild, new FakeMember({ id: 'user-1', rolePosition: 5 }));
    const interaction = interactionFor(guild, invoker);

    await expect(guard(guild, interaction, target)).resolves.toBe(true);
    expect(interaction.surfaces).toHaveLength(0);
  });

  it('denies a self-target', async () => {
    const { guild, invoker } = harness();
    const interaction = interactionFor(guild, invoker);

    await expect(guard(guild, interaction, invoker)).resolves.toBe(false);
    expect(interaction.lastEmbed()?.['description']).toBe('You cannot moderate yourself.');
  });

  it('denies the guild owner as a target', async () => {
    const { guild, invoker } = harness();
    const owner = addMember(guild, new FakeMember({ id: OWNER_ID, rolePosition: 99 }));
    const interaction = interactionFor(guild, invoker);

    await expect(guard(guild, interaction, owner)).resolves.toBe(false);
    expect(interaction.lastEmbed()?.['description']).toBe('You cannot moderate the server owner.');
  });

  it('denies the bot itself as a target', async () => {
    const { guild, bot, invoker } = harness();
    const interaction = interactionFor(guild, invoker);

    await expect(guard(guild, interaction, bot)).resolves.toBe(false);
    expect(interaction.lastEmbed()?.['description']).toBe('I cannot moderate myself.');
  });

  it('denies a target at or above the invoker', async () => {
    const { guild, invoker } = harness();
    const peer = addMember(guild, new FakeMember({ id: 'peer-1', rolePosition: 10 }));
    const senior = addMember(guild, new FakeMember({ id: 'senior-1', rolePosition: 15 }));
    const interaction = interactionFor(guild, invoker);

    await expect(guard(guild, interaction, peer)).resolves.toBe(false);
    expect(interaction.lastEmbed()?.['description']).toBe(
      'You can only moderate members whose highest role is below yours.',
    );

    const interaction2 = interactionFor(guild, invoker);
    await expect(guard(guild, interaction2, senior)).resolves.toBe(false);
    expect(interaction2.lastEmbed()?.['description']).toBe(
      'You can only moderate members whose highest role is below yours.',
    );
  });

  it('denies a target at or above the bot, even for a senior invoker', async () => {
    const { guild, invoker } = harness({ invokerPosition: 30 });
    const high = addMember(guild, new FakeMember({ id: 'high-1', rolePosition: 25 }));
    const interaction = interactionFor(guild, invoker);

    await expect(guard(guild, interaction, high)).resolves.toBe(false);
    expect(interaction.lastEmbed()?.['description']).toBe(
      'I can only moderate members whose highest role is below mine.',
    );
  });

  it('lets the guild owner invoker bypass the invoker check but not the bot check', async () => {
    const { guild } = harness();
    const ownerInvoker = addMember(
      guild,
      new FakeMember({ id: OWNER_ID, rolePosition: 0, permissions: ALL_MOD_PERMS }),
    );
    const mid = addMember(guild, new FakeMember({ id: 'user-2', rolePosition: 15 }));
    const high = addMember(guild, new FakeMember({ id: 'high-2', rolePosition: 25 }));

    const okInteraction = new FakeInteraction({
      user: fakeUser(OWNER_ID),
      guild,
      member: ownerInvoker,
    });
    await expect(guard(guild, okInteraction, mid)).resolves.toBe(true);

    const deniedInteraction = new FakeInteraction({
      user: fakeUser(OWNER_ID),
      guild,
      member: ownerInvoker,
    });
    await expect(guard(guild, deniedInteraction, high)).resolves.toBe(false);
    expect(deniedInteraction.lastEmbed()?.['description']).toBe(
      'I can only moderate members whose highest role is below mine.',
    );
  });

  it('denies when the invoker lacks the required permission', async () => {
    const { guild, invoker } = harness({ invokerPermissions: 0n });
    const target = addMember(guild, new FakeMember({ id: 'user-3', rolePosition: 1 }));
    const interaction = interactionFor(guild, invoker);

    await expect(guard(guild, interaction, target)).resolves.toBe(false);
    expect(interaction.lastEmbed()?.['description']).toBe(
      'You need the Ban Members permission to perform this action.',
    );
  });

  it('denies when the bot lacks the required permission', async () => {
    const { guild, invoker } = harness({ botPermissions: 0n });
    const target = addMember(guild, new FakeMember({ id: 'user-4', rolePosition: 1 }));
    const interaction = interactionFor(guild, invoker);

    await expect(guard(guild, interaction, target)).resolves.toBe(false);
    expect(interaction.lastEmbed()?.['description']).toBe(
      'I need the Ban Members permission to perform this action.',
    );
  });

  it('denies a target from another guild', async () => {
    const { guild, invoker } = harness();
    const otherGuild = new FakeGuild('someone-else', null, [], 'guild-2');
    const foreign = new FakeMember({ id: 'user-5', rolePosition: 1 });
    foreign.guild = otherGuild;
    const interaction = interactionFor(guild, invoker);

    await expect(guard(guild, interaction, foreign)).resolves.toBe(false);
    expect(interaction.lastEmbed()?.['description']).toBe(
      'That member does not belong to this server.',
    );
  });
});

describe('guardBotPermission', () => {
  it('passes when the bot holds the permission', async () => {
    const { guild, invoker } = harness();
    const interaction = interactionFor(guild, invoker);
    await expect(
      guardBotPermission(
        makeCtx(),
        interaction as unknown as ChatInputCommandInteraction,
        PermissionFlagsBits.BanMembers,
        'Ban Members',
      ),
    ).resolves.toBe(true);
  });

  it('fails outside a guild', async () => {
    const interaction = new FakeInteraction({ user: fakeUser(MOD_ID), guild: null });
    await expect(
      guardBotPermission(
        makeCtx(),
        interaction as unknown as ChatInputCommandInteraction,
        PermissionFlagsBits.BanMembers,
        'Ban Members',
      ),
    ).resolves.toBe(false);
    expect(interaction.lastEmbed()?.['description']).toBe(
      'This command can only be used in a server.',
    );
  });
});

describe('fetchTargetMember', () => {
  it('returns the member when the fetch succeeds', async () => {
    const { guild } = harness();
    const member = await fetchTargetMember(guild as unknown as Guild, MOD_ID);
    expect(member?.id).toBe(MOD_ID);
  });

  it('returns null ONLY on Unknown Member', async () => {
    const { guild } = harness();
    await expect(fetchTargetMember(guild as unknown as Guild, 'ghost-1')).resolves.toBeNull();
  });

  it('propagates other API errors instead of treating them as absence', async () => {
    const { guild } = harness();
    guild.fetchError = discordApiError(
      RESTJSONErrorCodes.MissingPermissions,
      'Missing Permissions',
    );
    await expect(fetchTargetMember(guild as unknown as Guild, MOD_ID)).rejects.toMatchObject({
      code: RESTJSONErrorCodes.MissingPermissions,
    });

    guild.fetchError = new Error('socket hang up');
    await expect(fetchTargetMember(guild as unknown as Guild, MOD_ID)).rejects.toThrow(
      'socket hang up',
    );
  });
});

describe('confirmSuccess (Phase 6, G14)', () => {
  it('a 10062 on the confirmation does not turn a completed action into a failure', async () => {
    const { logger, entries } = capturingLogger();
    const ctx = makeCtx({ logger });
    const interaction = {
      id: 'ix-expired',
      commandName: 'ban',
      replied: false,
      deferred: true,
      editReply: async () => {
        throw discordApiError(10062, 'Unknown interaction');
      },
      followUp: async () => ({}),
      reply: async () => ({}),
    } as unknown as ChatInputCommandInteraction;
    await expect(
      confirmSuccess(ctx, interaction, successEmbed('User banned', 'done')),
    ).resolves.toBeUndefined();
    expect(
      entries().some(
        (entry) =>
          entry['msg'] ===
          'Moderation action succeeded but its confirmation could not be delivered',
      ),
    ).toBe(true);
  });
});

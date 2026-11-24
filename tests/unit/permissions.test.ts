import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { canModerate, hasPermissions, type HierarchyActor } from '../../src/core/permissions.js';

function actor(id: string, highestRolePosition: number, isOwner = false): HierarchyActor {
  return { id, highestRolePosition, isOwner };
}

describe('hasPermissions', () => {
  it('is true when nothing is required, even without a holder', () => {
    expect(hasPermissions(null, [])).toBe(true);
    expect(hasPermissions(undefined, [])).toBe(true);
  });

  it('is false when a holder is missing but permissions are required', () => {
    expect(hasPermissions(null, [PermissionFlagsBits.BanMembers])).toBe(false);
  });

  it('delegates to a real PermissionsBitField (all flags required)', () => {
    const holder = new PermissionsBitField(PermissionFlagsBits.BanMembers);
    expect(hasPermissions(holder, [PermissionFlagsBits.BanMembers])).toBe(true);
    expect(
      hasPermissions(holder, [PermissionFlagsBits.BanMembers, PermissionFlagsBits.KickMembers]),
    ).toBe(false);
  });
});

describe('canModerate hierarchy matrix', () => {
  const bot = actor('bot', 20);

  it('ok: target below both invoker and bot', () => {
    expect(canModerate({ invoker: actor('mod', 10), bot, target: actor('user', 5) })).toBe('ok');
  });

  it('self target is denied first', () => {
    const mod = actor('mod', 10);
    expect(canModerate({ invoker: mod, bot, target: mod })).toBe('self-target');
  });

  it('guild owner can never be a target', () => {
    expect(canModerate({ invoker: actor('mod', 10), bot, target: actor('owner', 99, true) })).toBe(
      'owner-target',
    );
  });

  it('the bot can never be a target', () => {
    expect(canModerate({ invoker: actor('mod', 10), bot, target: actor('bot', 1) })).toBe(
      'bot-target',
    );
  });

  it('target at or above the invoker is denied', () => {
    expect(canModerate({ invoker: actor('mod', 10), bot, target: actor('peer', 10) })).toBe(
      'target-not-below-invoker',
    );
    expect(canModerate({ invoker: actor('mod', 10), bot, target: actor('admin', 15) })).toBe(
      'target-not-below-invoker',
    );
  });

  it('target at or above the bot is denied even for a senior invoker', () => {
    expect(canModerate({ invoker: actor('admin', 30), bot, target: actor('high', 20) })).toBe(
      'target-not-below-bot',
    );
  });

  it('guild owner invoker bypasses the invoker check but not the bot check', () => {
    const owner = actor('owner', 0, true);
    expect(canModerate({ invoker: owner, bot, target: actor('user', 15) })).toBe('ok');
    expect(canModerate({ invoker: owner, bot, target: actor('high', 25) })).toBe(
      'target-not-below-bot',
    );
  });
});

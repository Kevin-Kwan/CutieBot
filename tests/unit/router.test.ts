import type { Interaction } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import type { CommandModule, ComponentModule } from '../../src/core/contracts.js';
import { registerCommand, registerComponent } from '../../src/core/registry.js';
import {
  GENERIC_ERROR_MESSAGE,
  GUILD_ONLY_MESSAGE,
  MISSING_PERMISSIONS_MESSAGE,
  OWNER_ONLY_MESSAGE,
  STALE_COMPONENT_MESSAGE,
  UNKNOWN_COMMAND_MESSAGE,
  handleInteraction,
  parseComponentId,
} from '../../src/core/router.js';
import { FakeChatInputInteraction, FakeComponentInteraction, makeCtx } from '../fixtures/fakes.js';

function commandModule(partial: Partial<CommandModule> & { name: string }): CommandModule {
  const { name, ...rest } = partial;
  return {
    data: { name, toJSON: () => ({ name, description: 'test command' }) },
    execute: () => Promise.resolve(),
    ...rest,
  };
}

function asInteraction(fake: FakeChatInputInteraction | FakeComponentInteraction): Interaction {
  return fake as unknown as Interaction;
}

describe('router — chat input commands', () => {
  it('replies once with the unknown-command message for unregistered commands', async () => {
    const ctx = makeCtx();
    const interaction = new FakeChatInputInteraction();
    interaction.commandName = 'nope';
    await handleInteraction(ctx, asInteraction(interaction));
    expect(interaction.surfaces).toHaveLength(1);
    expect(interaction.surfaces[0]?.options).toMatchObject({ content: UNKNOWN_COMMAND_MESSAGE });
  });

  it('refuses guild-only commands in DMs without executing', async () => {
    const ctx = makeCtx();
    const execute = vi.fn(() => Promise.resolve());
    registerCommand(
      ctx.registry,
      commandModule({ name: 'test', policy: { guildOnly: true }, execute }),
    );
    const interaction = new FakeChatInputInteraction();
    interaction.guildId = null;
    await handleInteraction(ctx, asInteraction(interaction));
    expect(execute).not.toHaveBeenCalled();
    expect(interaction.surfaces).toHaveLength(1);
    expect(interaction.surfaces[0]?.options).toMatchObject({ content: GUILD_ONLY_MESSAGE });
  });

  it('refuses owner-only commands for non-owners', async () => {
    const ctx = makeCtx();
    const execute = vi.fn(() => Promise.resolve());
    registerCommand(
      ctx.registry,
      commandModule({ name: 'test', policy: { ownerOnly: true }, execute }),
    );
    const interaction = new FakeChatInputInteraction();
    interaction.user = { id: 'not-the-owner' };
    await handleInteraction(ctx, asInteraction(interaction));
    expect(execute).not.toHaveBeenCalled();
    expect(interaction.surfaces[0]?.options).toMatchObject({ content: OWNER_ONLY_MESSAGE });
  });

  it('re-checks member permissions even though Discord also gates them', async () => {
    const ctx = makeCtx();
    const execute = vi.fn(() => Promise.resolve());
    registerCommand(
      ctx.registry,
      commandModule({ name: 'test', policy: { permissions: [2n] }, execute }),
    );
    const interaction = new FakeChatInputInteraction();
    interaction.memberPermissions = null;
    await handleInteraction(ctx, asInteraction(interaction));
    expect(execute).not.toHaveBeenCalled();
    expect(interaction.surfaces[0]?.options).toMatchObject({
      content: MISSING_PERMISSIONS_MESSAGE,
    });
  });

  it('blocks a second run while the cooldown is active', async () => {
    const ctx = makeCtx();
    const execute = vi.fn(() => Promise.resolve());
    registerCommand(
      ctx.registry,
      commandModule({ name: 'test', policy: { cooldownMs: 60_000 }, execute }),
    );
    const first = new FakeChatInputInteraction();
    await handleInteraction(ctx, asInteraction(first));
    const second = new FakeChatInputInteraction();
    await handleInteraction(ctx, asInteraction(second));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(second.surfaces).toHaveLength(1);
    expect(second.surfaces[0]?.options).toMatchObject({
      content: expect.stringContaining('Slow down') as unknown,
    });
  });

  it('surfaces exactly one error when a handler throws before acking', async () => {
    const ctx = makeCtx();
    registerCommand(
      ctx.registry,
      commandModule({
        name: 'test',
        execute: () => Promise.reject(new Error('kaboom')),
      }),
    );
    const interaction = new FakeChatInputInteraction();
    await handleInteraction(ctx, asInteraction(interaction));
    expect(interaction.surfaces).toHaveLength(1);
    expect(interaction.surfaces[0]?.method).toBe('reply');
    expect(interaction.surfaces[0]?.options).toMatchObject({ content: GENERIC_ERROR_MESSAGE });
  });

  it('surfaces exactly one error (via editReply) when a handler throws after deferring', async () => {
    const ctx = makeCtx();
    registerCommand(
      ctx.registry,
      commandModule({
        name: 'test',
        execute: async (_ctx, interaction) => {
          await interaction.deferReply();
          throw new Error('kaboom after defer');
        },
      }),
    );
    const interaction = new FakeChatInputInteraction();
    await handleInteraction(ctx, asInteraction(interaction));
    const surfaces = interaction.calls.filter((c) => c.method === 'editReply');
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0]?.options).toMatchObject({ content: GENERIC_ERROR_MESSAGE });
    expect(interaction.calls.filter((c) => c.method === 'reply')).toHaveLength(0);
    expect(interaction.calls.filter((c) => c.method === 'followUp')).toHaveLength(0);
  });

  it('runs a well-behaved command with no error surface', async () => {
    const ctx = makeCtx();
    const execute = vi.fn((_ctx: unknown, interaction: FakeChatInputInteraction) =>
      interaction.reply({ content: 'done' }),
    );
    registerCommand(ctx.registry, commandModule({ name: 'test', execute: execute as never }));
    const interaction = new FakeChatInputInteraction();
    await handleInteraction(ctx, asInteraction(interaction));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(interaction.surfaces).toHaveLength(1);
    expect(interaction.surfaces[0]?.options).toMatchObject({ content: 'done' });
  });
});

describe('router — components', () => {
  it('dispatches by feature:action key and passes arg segments', async () => {
    const ctx = makeCtx();
    const seen: { args: readonly string[] } = { args: [] };
    const component: ComponentModule = {
      key: 'music:skip',
      execute: (_ctx, _interaction, args) => {
        seen.args = args;
        return Promise.resolve();
      },
    };
    registerComponent(ctx.registry, component);
    const interaction = new FakeComponentInteraction();
    interaction.customId = 'music:skip:session-42';
    await handleInteraction(ctx, asInteraction(interaction));
    expect(seen.args).toEqual(['session-42']);
    expect(interaction.calls).toHaveLength(0);
  });

  it('replies with the stale-control message for unknown components', async () => {
    const ctx = makeCtx();
    const interaction = new FakeComponentInteraction();
    interaction.customId = 'music:explode';
    await handleInteraction(ctx, asInteraction(interaction));
    expect(interaction.calls).toHaveLength(1);
    expect(interaction.calls[0]?.options).toMatchObject({ content: STALE_COMPONENT_MESSAGE });
  });
});

describe('parseComponentId', () => {
  it('parses feature, action, and args', () => {
    expect(parseComponentId('music:skip')).toEqual({ key: 'music:skip', args: [] });
    expect(parseComponentId('music:loop:track:3')).toEqual({
      key: 'music:loop',
      args: ['track', '3'],
    });
  });

  it('rejects malformed IDs', () => {
    expect(parseComponentId('music')).toBeNull();
    expect(parseComponentId(':skip')).toBeNull();
    expect(parseComponentId('music:')).toBeNull();
    expect(parseComponentId('')).toBeNull();
  });
});

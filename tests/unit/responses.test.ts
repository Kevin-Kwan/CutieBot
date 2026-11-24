import { MessageFlags } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { deferIfNeeded, isUnknownInteraction, safeErrorReply } from '../../src/core/responses.js';
import { FakeChatInputInteraction } from '../fixtures/fakes.js';

describe('safeErrorReply', () => {
  it('replies ephemerally when the interaction is untouched', async () => {
    const interaction = new FakeChatInputInteraction();
    await safeErrorReply(interaction, 'boom');
    expect(interaction.calls).toHaveLength(1);
    expect(interaction.calls[0]?.method).toBe('reply');
    expect(interaction.calls[0]?.options).toMatchObject({
      content: 'boom',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('edits the reply when the interaction is deferred', async () => {
    const interaction = new FakeChatInputInteraction();
    interaction.deferred = true;
    await safeErrorReply(interaction, 'boom');
    expect(interaction.calls).toHaveLength(1);
    expect(interaction.calls[0]?.method).toBe('editReply');
  });

  it('follows up when the interaction was already replied to', async () => {
    const interaction = new FakeChatInputInteraction();
    interaction.replied = true;
    await safeErrorReply(interaction, 'boom');
    expect(interaction.calls).toHaveLength(1);
    expect(interaction.calls[0]?.method).toBe('followUp');
    expect(interaction.calls[0]?.options).toMatchObject({ flags: MessageFlags.Ephemeral });
  });

  it('swallows a 10062 unknown-interaction error', async () => {
    const interaction = new FakeChatInputInteraction();
    interaction.replyError = Object.assign(new Error('Unknown interaction'), { code: 10062 });
    await expect(safeErrorReply(interaction, 'boom')).resolves.toBeUndefined();
  });

  it('propagates other reply failures', async () => {
    const interaction = new FakeChatInputInteraction();
    interaction.replyError = new Error('network down');
    await expect(safeErrorReply(interaction, 'boom')).rejects.toThrow('network down');
  });
});

describe('isUnknownInteraction', () => {
  it('detects code 10062 and rejects other shapes', () => {
    expect(isUnknownInteraction({ code: 10062 })).toBe(true);
    expect(isUnknownInteraction({ code: 50001 })).toBe(false);
    expect(isUnknownInteraction(new Error('x'))).toBe(false);
    expect(isUnknownInteraction(null)).toBe(false);
    expect(isUnknownInteraction('10062')).toBe(false);
  });
});

describe('deferIfNeeded', () => {
  it('defers a fresh interaction exactly once', async () => {
    const interaction = new FakeChatInputInteraction();
    await expect(deferIfNeeded(interaction)).resolves.toBe('deferred');
    expect(interaction.deferred).toBe(true);
    await expect(deferIfNeeded(interaction)).resolves.toBe('already-acknowledged');
    expect(interaction.calls.filter((c) => c.method === 'deferReply')).toHaveLength(1);
  });

  it('does not defer an already-replied interaction', async () => {
    const interaction = new FakeChatInputInteraction();
    interaction.replied = true;
    await expect(deferIfNeeded(interaction)).resolves.toBe('already-acknowledged');
    expect(interaction.calls).toHaveLength(0);
  });

  // P1-11 regression: an expired interaction (10062) must be
  // distinguishable from an already-acknowledged one, so callers can
  // abort instead of mutating state on a dead interaction.
  it('reports expired when deferReply rejects with 10062', async () => {
    const interaction = new FakeChatInputInteraction();
    interaction.deferError = Object.assign(new Error('Unknown interaction'), { code: 10062 });
    await expect(deferIfNeeded(interaction)).resolves.toBe('expired');
  });

  it('propagates non-10062 defer failures', async () => {
    const interaction = new FakeChatInputInteraction();
    interaction.deferError = new Error('network down');
    await expect(deferIfNeeded(interaction)).rejects.toThrow('network down');
  });
});

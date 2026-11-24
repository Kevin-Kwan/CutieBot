import type { ChatInputCommandInteraction, Client } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isHttpUrl, setavatarCommand } from '../../../src/features/admin/commands/setavatar.js';
import { restartCommand } from '../../../src/features/admin/commands/restart.js';
import { setusernameCommand } from '../../../src/features/admin/commands/setusername.js';
import { makeCtx } from '../../fixtures/fakes.js';
import { capturingLogger } from '../../fixtures/moderation.js';

interface RecordedReply {
  embeds?: { toJSON: () => Record<string, unknown> }[];
  content?: string;
}

function fakeInteraction(
  strings: Record<string, string | null> = {},
  attachment: { url: string } | null = null,
) {
  const replies: RecordedReply[] = [];
  const interaction = {
    user: { id: 'owner-1' },
    options: {
      getString: (name: string) => strings[name] ?? null,
      getAttachment: () => attachment,
    },
    reply: async (payload: RecordedReply) => {
      replies.push(payload);
      return {};
    },
    // Phase 6: setavatar/setusername defer first, then editReply.
    deferReply: async () => {
      interaction.deferred = true;
      return {};
    },
    editReply: async (payload: RecordedReply) => {
      replies.push(payload);
      return {};
    },
    deferred: false,
  };
  return { interaction, replies };
}

function asInteraction(value: unknown): ChatInputCommandInteraction {
  return value as ChatInputCommandInteraction;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('/restart', () => {
  it('is owner-only in policy', () => {
    expect(restartCommand.policy).toMatchObject({ ownerOnly: true });
    expect(setavatarCommand.policy).toMatchObject({ ownerOnly: true });
    expect(setusernameCommand.policy).toMatchObject({ ownerOnly: true });
  });

  it('confirms first, logs, then sends itself SIGTERM for the graceful shutdown', async () => {
    const { logger, entries } = capturingLogger();
    const ctx = makeCtx({ logger });
    const { interaction, replies } = fakeInteraction();

    const order: string[] = [];
    const originalReply = interaction.reply.bind(interaction);
    interaction.reply = async (payload: RecordedReply) => {
      order.push('reply');
      return originalReply(payload);
    };
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      order.push('kill');
      return true;
    });

    await restartCommand.execute(ctx, asInteraction(interaction));

    expect(replies[0]?.embeds?.[0]?.toJSON()['title']).toBe('Restarting');
    expect(replies[0]?.embeds?.[0]?.toJSON()['description']).toMatch(/shutting down now/);
    expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGTERM');
    expect(order).toEqual(['reply', 'kill']);

    const restartLog = entries().find((entry) => entry['action'] === 'restart');
    expect(restartLog).toBeDefined();
    expect(restartLog?.['msg']).toMatch(/Restart requested by owner/);
    expect(restartLog?.['actorId']).toBe('owner-1');
  });
});

describe('isHttpUrl', () => {
  it.each([
    ['https://cdn.example.com/a.png', true],
    ['http://example.com/a.png', true],
    ['ftp://example.com/a.png', false],
    ['javascript:alert(1)', false],
    ['not a url', false],
    ['', false],
  ])('%s → %s', (value, expected) => {
    expect(isHttpUrl(value)).toBe(expected);
  });
});

describe('/setavatar', () => {
  function avatarClient(): { client: Record<string, unknown>; calls: string[] } {
    const calls: string[] = [];
    const user = {
      tag: 'CutieBot#1234',
      setAvatar: async (url: string) => {
        calls.push(url);
        return user;
      },
    };
    return { client: { user }, calls };
  }

  it('applies a valid http(s) URL and confirms after it settles', async () => {
    const { client, calls } = avatarClient();
    const ctx = makeCtx({ client: client as unknown as Client });
    const { interaction, replies } = fakeInteraction({ url: 'https://cdn.example.com/new.png' });

    await setavatarCommand.execute(ctx, asInteraction(interaction));

    expect(calls).toEqual(['https://cdn.example.com/new.png']);
    expect(replies[0]?.embeds?.[0]?.toJSON()['title']).toBe('Avatar Updated');
  });

  it('rejects a non-URL without calling setAvatar', async () => {
    const { client, calls } = avatarClient();
    const ctx = makeCtx({ client: client as unknown as Client });
    const { interaction, replies } = fakeInteraction({ url: 'not a url' });

    await setavatarCommand.execute(ctx, asInteraction(interaction));

    expect(calls).toHaveLength(0);
    expect(replies[0]?.embeds?.[0]?.toJSON()['description']).toBe(
      'Please provide a valid https image URL (no credentials).',
    );
  });

  // Phase 6 (P2-14): an uploaded attachment is the preferred input.
  it('prefers an uploaded attachment over the URL option', async () => {
    const { client, calls } = avatarClient();
    const ctx = makeCtx({ client: client as unknown as Client });
    const { interaction, replies } = fakeInteraction(
      { url: 'https://cdn.example.com/other.png' },
      { url: 'https://cdn.discordapp.com/attachments/1/2/avatar.png' },
    );

    await setavatarCommand.execute(ctx, asInteraction(interaction));

    expect(calls).toEqual(['https://cdn.discordapp.com/attachments/1/2/avatar.png']);
    expect(replies[0]?.embeds?.[0]?.toJSON()['title']).toBe('Avatar Updated');
  });

  it('rejects credential-bearing URLs', async () => {
    const { client, calls } = avatarClient();
    const ctx = makeCtx({ client: client as unknown as Client });
    const { interaction } = fakeInteraction({ url: 'https://user:pass@cdn.example.com/a.png' });

    await setavatarCommand.execute(ctx, asInteraction(interaction));

    expect(calls).toHaveLength(0);
  });
});

describe('/setusername', () => {
  it('sets the username and confirms', async () => {
    const calls: string[] = [];
    const user = {
      tag: 'CutieBot#1234',
      setUsername: async (name: string) => {
        calls.push(name);
        return user;
      },
    };
    const ctx = makeCtx({ client: { user } as unknown as Client });
    const { interaction, replies } = fakeInteraction({ name: 'CutieBot v3' });

    await setusernameCommand.execute(ctx, asInteraction(interaction));

    expect(calls).toEqual(['CutieBot v3']);
    expect(replies[0]?.embeds?.[0]?.toJSON()['title']).toBe('Username Updated');
  });
});

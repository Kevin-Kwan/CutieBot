import type { ChatInputCommandInteraction, Client, User } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { avatarCommand } from '../../../src/features/utility/commands/avatar.js';
import { botinfoCommand } from '../../../src/features/utility/commands/botinfo.js';
import { uptimeCommand } from '../../../src/features/utility/commands/uptime.js';
import { makeCtx } from '../../fixtures/fakes.js';

function fakeClientUser(tag: string, username: string): Record<string, unknown> {
  return {
    tag,
    username,
    displayAvatarURL: () => 'https://cdn.example.com/bot.png',
  };
}

function fakeClient(): Record<string, unknown> {
  return {
    user: fakeClientUser('CutieBot#1234', 'CutieBot'),
    uptime: 90_061_000, // 1 day, 1 hour, 1 minute, 1 second
    ws: { ping: 42.4 },
    guilds: { cache: { size: 3 } },
    users: { cache: { size: 128 } },
  };
}

interface RecordedReply {
  embeds?: { toJSON: () => Record<string, unknown> }[];
}

function fakeInteraction(optionUser: Record<string, unknown> | null) {
  const replies: RecordedReply[] = [];
  const interaction = {
    user: {
      id: 'user-1',
      username: 'kevin',
      displayAvatarURL: () => 'https://cdn.example.com/kevin.png',
    },
    options: {
      getUser: (name: string) => (name === 'user' ? optionUser : null),
    },
    reply: async (payload: RecordedReply) => {
      replies.push(payload);
      return {};
    },
  };
  return { interaction, replies };
}

function asInteraction(value: unknown): ChatInputCommandInteraction {
  return value as ChatInputCommandInteraction;
}

describe('/uptime', () => {
  it('reports the client uptime in long form', async () => {
    const ctx = makeCtx({ client: fakeClient() as unknown as Client });
    const { interaction, replies } = fakeInteraction(null);

    await uptimeCommand.execute(ctx, asInteraction(interaction));

    const embed = replies[0]?.embeds?.[0]?.toJSON();
    expect(embed?.['title']).toBe('Bot Uptime');
    expect(embed?.['description']).toBe('Total Uptime: 1 days, 1 hours, 1 minutes, 1 seconds');
  });
});

describe('/botinfo', () => {
  it('reports name, ping, guild and user counts, uptime, and memory', async () => {
    const ctx = makeCtx({ client: fakeClient() as unknown as Client });
    const { interaction, replies } = fakeInteraction(null);

    await botinfoCommand.execute(ctx, asInteraction(interaction));

    const embed = replies[0]?.embeds?.[0]?.toJSON();
    expect(embed?.['title']).toBe('Bot Information');
    const fields = (embed?.['fields'] ?? []) as { name: string; value: string }[];
    const byName = new Map(fields.map((field) => [field.name, field.value]));
    expect(byName.get('Bot Name')).toBe('CutieBot#1234');
    expect(byName.get('Gateway Ping')).toBe('42 ms');
    expect(byName.get('Guilds')).toBe('3');
    expect(byName.get('Cached Users')).toBe('128');
    expect(byName.get('Uptime')).toBe('1 days, 1 hours, 1 minutes, 1 seconds');
    expect(byName.get('Memory Usage')).toMatch(/^\d+\.\d MB$/);
  });
});

describe('/avatar', () => {
  it('defaults to the invoker when no user option is given', async () => {
    const ctx = makeCtx({ client: fakeClient() as unknown as Client });
    const { interaction, replies } = fakeInteraction(null);

    await avatarCommand.execute(ctx, asInteraction(interaction));

    const embed = replies[0]?.embeds?.[0]?.toJSON();
    expect(embed?.['title']).toBe("kevin's Avatar");
    expect((embed?.['image'] as { url?: string } | undefined)?.url).toBe(
      'https://cdn.example.com/kevin.png',
    );
  });

  it('shows the requested user when the option is given', async () => {
    const ctx = makeCtx({ client: fakeClient() as unknown as Client });
    const other = {
      id: 'user-2',
      username: 'nina',
      displayAvatarURL: () => 'https://cdn.example.com/nina.png',
    } as unknown as User;
    const { interaction, replies } = fakeInteraction(other as unknown as Record<string, unknown>);

    await avatarCommand.execute(ctx, asInteraction(interaction));

    const embed = replies[0]?.embeds?.[0]?.toJSON();
    expect(embed?.['title']).toBe("nina's Avatar");
    expect((embed?.['image'] as { url?: string } | undefined)?.url).toBe(
      'https://cdn.example.com/nina.png',
    );
  });
});

describe('/botinvite (Phase 6 — legacy parity)', () => {
  it('builds an OAuth2 invite URL from the configured client id', async () => {
    const { botinviteCommand, inviteUrlFor } =
      await import('../../../src/features/utility/commands/botinvite.js');
    const url = inviteUrlFor('123456789012345678');
    expect(url).toContain('https://discord.com/oauth2/authorize?');
    expect(url).toContain('client_id=123456789012345678');
    expect(url).toContain('scope=bot+applications.commands');
    expect(url).toContain('permissions=');
    expect((botinviteCommand.data.toJSON() as { name?: string })['name']).toBe('botinvite');
  });
});

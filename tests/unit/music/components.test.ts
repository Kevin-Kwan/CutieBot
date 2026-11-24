import type { MessageComponentInteraction } from 'discord.js';
import { describe, expect, it } from 'vitest';
import {
  backComponent,
  controllerRow,
  loopComponent,
  saveComponent,
  skipComponent,
  volumeRow,
  volumeUpComponent,
} from '../../../src/features/music/components/controller.js';
import { searchSelectComponent } from '../../../src/features/music/components/search-select.js';
import { searchSessions } from '../../../src/features/music/sessions.js';
import {
  FakeMusicComponentInteraction,
  FakePlayer,
  FakeQueue,
  fakeTrack,
  makeMusicCtx,
} from '../../fixtures/music.js';

function asComponent(fake: FakeMusicComponentInteraction): MessageComponentInteraction {
  return fake as unknown as MessageComponentInteraction;
}

describe('controller components', () => {
  it('skip button works in the same channel', async () => {
    const player = new FakePlayer();
    const ctx = makeMusicCtx(player);
    const interaction = new FakeMusicComponentInteraction();
    await skipComponent.execute(ctx, asComponent(interaction), []);
    expect(player.queue?.calls).toContain('node.skip');
    expect(interaction.lastReplyText).toMatch(/skipped/);
  });

  it('skip button refuses a user in a different voice channel (legacy had no check)', async () => {
    const player = new FakePlayer();
    const ctx = makeMusicCtx(player);
    const interaction = new FakeMusicComponentInteraction();
    interaction.setVoiceChannel('vc-2');
    await skipComponent.execute(ctx, asComponent(interaction), []);
    expect(player.queue?.calls).not.toContain('node.skip');
    expect(interaction.lastReplyText).toMatch(/same voice channel/);
  });

  it('loop button cycles off → track', async () => {
    const player = new FakePlayer();
    const ctx = makeMusicCtx(player);
    const interaction = new FakeMusicComponentInteraction();
    interaction.customId = 'music:loop';
    await loopComponent.execute(ctx, asComponent(interaction), []);
    expect(player.queue?.calls).toContain('setRepeatMode:1');
    expect(interaction.lastReplyText).toMatch(/track/);
  });

  it('volume up button refuses at max volume', async () => {
    const player = new FakePlayer();
    const ctx = makeMusicCtx(player);
    const queue = player.queue;
    if (queue !== null) {
      queue.node.setVolume(100);
      queue.calls.length = 0;
    }
    const interaction = new FakeMusicComponentInteraction();
    interaction.customId = 'music:volumeup';
    await volumeUpComponent.execute(ctx, asComponent(interaction), []);
    expect(interaction.lastReplyText).toMatch(/can't turn the volume up/);
    expect(player.queue?.calls.filter((c) => c.startsWith('node.setVolume'))).toHaveLength(0);
  });
});

describe('search select component', () => {
  it('refuses picks from someone else\u2019s search', async () => {
    const player = new FakePlayer();
    const ctx = makeMusicCtx(player);
    searchSessions.put('sess-other', {
      userId: 'someone-else',
      guildId: 'guild-1',
      tracks: [fakeTrack()],
    });
    const interaction = new FakeMusicComponentInteraction();
    interaction.customId = 'music:select:sess-other';
    interaction.values = ['0'];
    await searchSelectComponent.execute(ctx, asComponent(interaction), ['sess-other']);
    expect(interaction.lastReplyText).toMatch(/belongs to someone else/);
  });

  it('refuses expired sessions', async () => {
    const player = new FakePlayer();
    const ctx = makeMusicCtx(player);
    const interaction = new FakeMusicComponentInteraction();
    interaction.customId = 'music:select:gone';
    interaction.values = ['0'];
    await searchSelectComponent.execute(ctx, asComponent(interaction), ['gone']);
    expect(interaction.lastReplyText).toMatch(/expired/);
  });

  it('a valid pick enqueues the track, updates the message, and consumes the session', async () => {
    const player = new FakePlayer();
    player.queue = null;
    const ctx = makeMusicCtx(player);
    searchSessions.put('sess-ok', {
      userId: 'user-1',
      guildId: 'guild-1',
      tracks: [fakeTrack({ title: 'Picked Song' })],
    });
    const interaction = new FakeMusicComponentInteraction();
    interaction.customId = 'music:select:sess-ok';
    interaction.values = ['0'];
    await searchSelectComponent.execute(ctx, asComponent(interaction), ['sess-ok']);

    const queue = player.createdQueues[0];
    expect(queue?.calls).toContain('connect');
    expect(queue?.calls).toContain('addTrack');
    expect(queue?.calls).toContain('node.play');
    // Phase 6 (G6): deferUpdate first, finish via editReply.
    expect(interaction.calls.some((c) => c.method === 'deferUpdate')).toBe(true);
    expect(interaction.calls.some((c) => c.method === 'editReply')).toBe(true);
    expect(searchSessions.get('sess-ok')).toBeUndefined();
  });

  // Phase 6 (P1-07): the session is consumed BEFORE the async work, so
  // a second delivery of the same pick finds nothing and adds nothing.
  it('a duplicated pick delivery cannot add the track twice', async () => {
    const player = new FakePlayer();
    player.queue = null;
    const ctx = makeMusicCtx(player);
    searchSessions.put('sess-dupe', {
      userId: 'user-1',
      guildId: 'guild-1',
      tracks: [fakeTrack({ title: 'Dupe Song' })],
    });
    const first = new FakeMusicComponentInteraction();
    first.customId = 'music:select:sess-dupe';
    first.values = ['0'];
    await searchSelectComponent.execute(ctx, asComponent(first), ['sess-dupe']);
    const second = new FakeMusicComponentInteraction();
    second.customId = 'music:select:sess-dupe';
    second.values = ['0'];
    await searchSelectComponent.execute(ctx, asComponent(second), ['sess-dupe']);

    expect(second.lastReplyText).toMatch(/expired/);
    const adds = player.createdQueues.flatMap((q) => q.calls).filter((c) => c === 'addTrack');
    expect(adds).toHaveLength(1);
  });

  // Phase 6c (R5, GPT's A/B sequence): the bot is playing in vc-1; the
  // invoker has MOVED to vc-2 since searching. The Phase 6 code checked
  // the stale snapshot before the lock and inserted anyway; the pick
  // must now be refused inside the lock and insert nothing.
  it("cannot insert into another channel's queue after the invoker moved", async () => {
    const player = new FakePlayer(); // queue exists, connected, channel vc-1
    const ctx = makeMusicCtx(player);
    searchSessions.put('sess-ab', {
      userId: 'user-1',
      guildId: 'guild-1',
      tracks: [fakeTrack({ title: 'Stowaway' })],
    });
    const interaction = new FakeMusicComponentInteraction();
    interaction.customId = 'music:select:sess-ab';
    interaction.values = ['0'];
    interaction.setVoiceChannel('vc-2');
    await searchSelectComponent.execute(ctx, asComponent(interaction), ['sess-ab']);

    expect(player.queue?.calls).not.toContain('addTrack');
    expect(player.queue?.upcoming).toHaveLength(2);
    expect(interaction.lastReplyText).toMatch(/same voice channel/);
    // Nothing was inserted, so the session is restored for a retry
    // from the right channel.
    expect(searchSessions.get('sess-ab')).toBeDefined();
  });

  // Phase 6e (R5-B): the queue exists but is NOT connected, so the
  // pick must connect first. The invoker leaves the channel WHILE the
  // connection is being established — the post-connect revalidation
  // must abort the pick: no insertion, session restored.
  it('does not insert when the invoker leaves during connection establishment (R5-B)', async () => {
    const player = new FakePlayer();
    const queue = player.queue;
    if (queue === null) throw new Error('fixture queue missing');
    queue.connection = null; // not yet connected → the pick connects
    const ctx = makeMusicCtx(player);
    searchSessions.put('sess-r5b', {
      userId: 'user-1',
      guildId: 'guild-1',
      tracks: [fakeTrack({ title: 'Late Leave' })],
    });
    const interaction = new FakeMusicComponentInteraction();
    interaction.customId = 'music:select:sess-r5b';
    interaction.values = ['0'];
    queue.connect = async (): Promise<FakeQueue> => {
      queue.calls.push('connect');
      queue.connection = { fake: true };
      interaction.setVoiceChannel(null); // invoker leaves mid-connect
      return queue;
    };
    await searchSelectComponent.execute(ctx, asComponent(interaction), ['sess-r5b']);

    expect(queue.calls).toContain('connect');
    expect(queue.calls).not.toContain('addTrack');
    expect(queue.upcoming.filter((t) => t.title === 'Late Leave')).toHaveLength(0);
    expect(interaction.lastReplyText).toMatch(/not in a voice channel/);
    // Nothing was inserted, so the session is restored for a retry.
    expect(searchSessions.get('sess-r5b')).toBeDefined();
  });

  // Phase 6c (R6): addTrack commits, then node.play() rejects. The
  // Phase 6 code restored the session on ANY throw, so a retry added
  // the same track twice. Once insertion commits the session stays
  // consumed.
  it('keeps the session consumed when play() rejects after insertion', async () => {
    const player = new FakePlayer();
    const queue = player.queue;
    if (queue === null) throw new Error('fixture queue missing');
    queue.currentTrack = null; // not playing → addAndStart will call node.play()
    queue.node.play = async (): Promise<void> => {
      throw new Error('no audio node');
    };
    const ctx = makeMusicCtx(player);
    searchSessions.put('sess-r6', {
      userId: 'user-1',
      guildId: 'guild-1',
      tracks: [fakeTrack({ title: 'Inserted Once' })],
    });
    const first = new FakeMusicComponentInteraction();
    first.customId = 'music:select:sess-r6';
    first.values = ['0'];
    await searchSelectComponent.execute(ctx, asComponent(first), ['sess-r6']);

    expect(queue.upcoming.filter((t) => t.title === 'Inserted Once')).toHaveLength(1);
    expect(searchSessions.get('sess-r6')).toBeUndefined();

    const retry = new FakeMusicComponentInteraction();
    retry.customId = 'music:select:sess-r6';
    retry.values = ['0'];
    await searchSelectComponent.execute(ctx, asComponent(retry), ['sess-r6']);
    expect(retry.lastReplyText).toMatch(/expired/);
    expect(queue.calls.filter((c) => c === 'addTrack')).toHaveLength(1);
  });
});

describe('session-bound controller buttons (Phase 6, P1-05/G5)', () => {
  const SESSION = 'aaaaaaaabbbb';

  function withSession(player: FakePlayer): void {
    if (player.queue !== null) {
      player.queue.metadata = {
        channel: { send: async () => ({}) },
        requestedById: 'user-1',
        sessionId: SESSION,
      };
    }
  }

  it('rows embed the session token in every custom id', () => {
    const ids = [...controllerRow(SESSION).components, ...volumeRow(SESSION).components].map(
      (button) => (button.toJSON() as { custom_id?: string })['custom_id'],
    );
    expect(ids).toContain(`music:skip:${SESSION}`);
    expect(ids).toContain(`music:nowplaying:${SESSION}`);
    expect(ids).toContain(`music:save:${SESSION}`);
    expect(ids.every((id) => typeof id === 'string' && id.endsWith(`:${SESSION}`))).toBe(true);
  });

  it('a click carrying the live session token works', async () => {
    const player = new FakePlayer();
    withSession(player);
    const ctx = makeMusicCtx(player);
    const interaction = new FakeMusicComponentInteraction();
    interaction.customId = `music:skip:${SESSION}`;
    await skipComponent.execute(ctx, asComponent(interaction), [SESSION]);
    expect(player.queue?.calls).toContain('node.skip');
  });

  it('a click from a superseded session is refused and changes nothing', async () => {
    const player = new FakePlayer();
    withSession(player);
    const ctx = makeMusicCtx(player);
    const interaction = new FakeMusicComponentInteraction();
    interaction.customId = 'music:skip:000000000000';
    await skipComponent.execute(ctx, asComponent(interaction), ['000000000000']);
    expect(player.queue?.calls).not.toContain('node.skip');
    expect(interaction.lastReplyText).toMatch(/earlier playback session/);
  });

  it('save DMs the current track to the clicker', async () => {
    const player = new FakePlayer();
    withSession(player);
    const ctx = makeMusicCtx(player);
    const interaction = new FakeMusicComponentInteraction();
    interaction.customId = `music:save:${SESSION}`;
    await saveComponent.execute(ctx, asComponent(interaction), [SESSION]);
    expect(interaction.sentDMs).toHaveLength(1);
    expect(String(interaction.sentDMs[0])).toContain('Test Song');
    expect(interaction.lastReplyText).toMatch(/DM/);
  });

  // Phase 6c (cheap P2): save acks BEFORE the DM send, and the
  // confirmation edits the deferred reply instead of followUp-ing.
  it('save defers before sending the DM', async () => {
    const player = new FakePlayer();
    withSession(player);
    const ctx = makeMusicCtx(player);
    const interaction = new FakeMusicComponentInteraction();
    interaction.customId = `music:save:${SESSION}`;
    await saveComponent.execute(ctx, asComponent(interaction), [SESSION]);
    const methods = interaction.calls.map((c) => c.method);
    expect(methods).toContain('deferReply');
    expect(methods.indexOf('deferReply')).toBeLessThan(methods.indexOf('editReply'));
    expect(interaction.lastReplyText).toMatch(/DM/);
  });

  it('back goes back when the fresh voice state agrees', async () => {
    const player = new FakePlayer();
    withSession(player);
    if (player.queue !== null) player.queue.history.previousTrack = fakeTrack();
    const ctx = makeMusicCtx(player);
    const interaction = new FakeMusicComponentInteraction();
    interaction.customId = `music:back:${SESSION}`;
    await backComponent.execute(ctx, asComponent(interaction), [SESSION]);
    expect(player.queue?.calls).toContain('history.back');
    expect(interaction.lastReplyText).toMatch(/previous/);
  });

  // Phase 6e (R5-C): the clicker's voice state changes DURING the
  // deferReply round-trip — after runMusicComponent's fresh check has
  // already passed. The in-body re-check, immediately before
  // history.back(), must refuse.
  it('back refuses when the clicker moves during the defer (R5-C)', async () => {
    const player = new FakePlayer();
    withSession(player);
    if (player.queue !== null) player.queue.history.previousTrack = fakeTrack();
    const ctx = makeMusicCtx(player);
    const interaction = new FakeMusicComponentInteraction();
    interaction.customId = `music:back:${SESSION}`;
    const originalDefer = interaction.deferReply.bind(interaction);
    interaction.deferReply = async (): Promise<unknown> => {
      const result = await originalDefer();
      interaction.setVoiceChannel('vc-2'); // moves while the defer is in flight
      return result;
    };
    await backComponent.execute(ctx, asComponent(interaction), [SESSION]);
    expect(player.queue?.calls).not.toContain('history.back');
    expect(interaction.lastReplyText).toMatch(/same voice channel/);
  });

  // Phase 6c (R5): back revalidates INSIDE the lock with a forced
  // fetch. The interaction SNAPSHOT still shows the invoker in the
  // bot's channel (a snapshot-only check would pass), but the fresh
  // fetch shows they moved — the history jump must not happen.
  it('back refuses when the fresh fetch shows the invoker moved channels', async () => {
    const player = new FakePlayer();
    withSession(player);
    if (player.queue !== null) player.queue.history.previousTrack = fakeTrack();
    const ctx = makeMusicCtx(player);
    const interaction = new FakeMusicComponentInteraction();
    interaction.customId = `music:back:${SESSION}`;
    interaction.guild = {
      name: 'Test Guild',
      members: {
        me: { voice: { channelId: 'vc-1' } },
        fetch: async () => ({
          voice: { channel: { id: 'vc-2', name: 'Elsewhere' }, channelId: 'vc-2' },
        }),
      },
    };
    await backComponent.execute(ctx, asComponent(interaction), [SESSION]);
    expect(player.queue?.calls).not.toContain('history.back');
    expect(interaction.lastReplyText).toMatch(/same voice channel/);
  });
});

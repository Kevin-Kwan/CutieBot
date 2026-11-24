import type { ChatInputCommandInteraction } from 'discord.js';
import { QueryType } from 'discord-player';
import { YoutubeExtractor } from 'discord-player-youtubei';
import { describe, expect, it } from 'vitest';
import { backCommand } from '../../../src/features/music/commands/back.js';
import { jumpCommand } from '../../../src/features/music/commands/jump.js';
import { leaveCommand } from '../../../src/features/music/commands/leave.js';
import { loopCommand } from '../../../src/features/music/commands/loop.js';
import { moveCommand } from '../../../src/features/music/commands/move.js';
import { pauseCommand } from '../../../src/features/music/commands/pause.js';
import { playCommand } from '../../../src/features/music/commands/play.js';
import { playnextCommand } from '../../../src/features/music/commands/playnext.js';
import { removeCommand } from '../../../src/features/music/commands/remove.js';
import { resumeCommand } from '../../../src/features/music/commands/resume.js';
import { searchCommand } from '../../../src/features/music/commands/search.js';
import { seekCommand } from '../../../src/features/music/commands/seek.js';
import { skipCommand } from '../../../src/features/music/commands/skip.js';
import { stopCommand } from '../../../src/features/music/commands/stop.js';
import { volumeCommand } from '../../../src/features/music/commands/volume.js';
import { withGuildQueueLock } from '../../../src/features/music/queue.js';
import { searchSessions } from '../../../src/features/music/sessions.js';
import {
  FakeMusicInteraction,
  FakePlayer,
  FakeQueue,
  fakeTrack,
  makeMusicCtx,
} from '../../fixtures/music.js';

function setup() {
  const player = new FakePlayer();
  const ctx = makeMusicCtx(player);
  const interaction = new FakeMusicInteraction();
  return { player, ctx, interaction };
}

function asInteraction(fake: FakeMusicInteraction): ChatInputCommandInteraction {
  return fake as unknown as ChatInputCommandInteraction;
}

describe('voice + queue guards through commands', () => {
  it('skip works when everything lines up', async () => {
    const { player, ctx, interaction } = setup();
    await skipCommand.execute(ctx, asInteraction(interaction));
    expect(player.queue?.calls).toContain('node.skip');
    expect(interaction.lastFollowUpText).toMatch(/skipped/);
  });

  it('skip refuses when there is no queue', async () => {
    const { player, ctx, interaction } = setup();
    player.queue = null;
    await skipCommand.execute(ctx, asInteraction(interaction));
    expect(interaction.lastFollowUpText).toMatch(/No music is currently playing/);
  });

  it('skip refuses when the invoker is not in voice', async () => {
    const { ctx, interaction } = setup();
    interaction.setVoiceChannel(null);
    await skipCommand.execute(ctx, asInteraction(interaction));
    expect(interaction.lastFollowUpText).toMatch(/not in a voice channel/);
  });

  it('skip refuses when the invoker is in a different channel than the bot', async () => {
    const { player, ctx, interaction } = setup();
    interaction.setVoiceChannel('vc-2');
    await skipCommand.execute(ctx, asInteraction(interaction));
    expect(interaction.lastFollowUpText).toMatch(/same voice channel/);
    expect(player.queue?.calls).not.toContain('node.skip');
  });
});

describe('pause / resume', () => {
  it('pause pauses, and refuses when already paused', async () => {
    const { player, ctx, interaction } = setup();
    await pauseCommand.execute(ctx, asInteraction(interaction));
    expect(player.queue?.calls).toContain('node.pause');

    const again = new FakeMusicInteraction();
    await pauseCommand.execute(ctx, asInteraction(again));
    expect(again.lastFollowUpText).toMatch(/already paused/);
  });

  it('resume refuses when not paused, then resumes after a pause', async () => {
    const { player, ctx, interaction } = setup();
    await resumeCommand.execute(ctx, asInteraction(interaction));
    expect(interaction.lastFollowUpText).toMatch(/not paused/);

    player.queue?.setPaused(true);
    const second = new FakeMusicInteraction();
    await resumeCommand.execute(ctx, asInteraction(second));
    expect(player.queue?.calls).toContain('node.resume');
    expect(second.lastFollowUpText).toMatch(/resumed/);
  });
});

describe('volume command', () => {
  it('sets a new volume', async () => {
    const { player, ctx, interaction } = setup();
    interaction.setOption('volume', 40);
    await volumeCommand.execute(ctx, asInteraction(interaction));
    expect(player.queue?.calls).toContain('node.setVolume:40');
    expect(interaction.lastFollowUpText).toMatch(/40/);
  });

  it('refuses the current volume', async () => {
    const { ctx, interaction } = setup();
    interaction.setOption('volume', 75);
    await volumeCommand.execute(ctx, asInteraction(interaction));
    expect(interaction.lastFollowUpText).toMatch(/already set/);
  });
});

describe('loop command', () => {
  it('enables track loop from off', async () => {
    const { player, ctx, interaction } = setup();
    interaction.setOption('action', 'track');
    await loopCommand.execute(ctx, asInteraction(interaction));
    expect(player.queue?.calls).toContain('setRepeatMode:1');
  });

  it('refuses a direct track→queue switch (legacy rule)', async () => {
    const { player, ctx, interaction } = setup();
    if (player.queue !== null) player.queue.repeatMode = 1;
    interaction.setOption('action', 'queue');
    await loopCommand.execute(ctx, asInteraction(interaction));
    expect(interaction.lastFollowUpText).toMatch(/first disable/);
    expect(player.queue?.calls).not.toContain('setRepeatMode:2');
  });
});

describe('remove / move / jump', () => {
  it('remove by number removes that upcoming track', async () => {
    const { player, ctx, interaction } = setup();
    interaction.setOption('number', 2);
    await removeCommand.execute(ctx, asInteraction(interaction));
    expect(player.queue?.upcoming.map((t) => t.title)).toEqual(['Second']);
    expect(interaction.lastFollowUpText).toMatch(/Removed \*\*Third\*\*/);
  });

  it('remove by exact title works; unknown titles error', async () => {
    const { player, ctx, interaction } = setup();
    interaction.setOption('song', 'Second');
    await removeCommand.execute(ctx, asInteraction(interaction));
    expect(player.queue?.upcoming.map((t) => t.title)).toEqual(['Third']);

    const missing = new FakeMusicInteraction().setOption('song', 'Nope');
    await removeCommand.execute(ctx, asInteraction(missing));
    expect(missing.lastFollowUpText).toMatch(/Could not find/);
  });

  it('move reorders the queue', async () => {
    const { player, ctx, interaction } = setup();
    interaction.setOption('from', 1).setOption('to', 2);
    await moveCommand.execute(ctx, asInteraction(interaction));
    expect(player.queue?.upcoming.map((t) => t.title)).toEqual(['Third', 'Second']);
    expect(player.queue?.calls).toContain('moveTrack:1');
  });

  it('jump refuses with an empty upcoming queue', async () => {
    const { player, ctx, interaction } = setup();
    if (player.queue !== null) player.queue.upcoming.length = 0;
    interaction.setOption('number', 1);
    await jumpCommand.execute(ctx, asInteraction(interaction));
    expect(interaction.lastFollowUpText).toMatch(/no tracks in the queue to jump to/i);
  });
});

describe('seek command', () => {
  it('seeks to a clock time', async () => {
    const { player, ctx, interaction } = setup();
    interaction.setOption('time', '1:30');
    await seekCommand.execute(ctx, asInteraction(interaction));
    expect(player.queue?.calls).toContain('node.seek:90000');
    expect(interaction.lastFollowUpText).toMatch(/1:30/);
  });

  it('refuses junk times and times past the end of the track', async () => {
    const { ctx, interaction } = setup();
    interaction.setOption('time', 'gibberish');
    await seekCommand.execute(ctx, asInteraction(interaction));
    expect(interaction.lastFollowUpText).toMatch(/could not understand/i);

    const past = new FakeMusicInteraction().setOption('time', '99:59');
    await seekCommand.execute(ctx, asInteraction(past));
    expect(past.lastFollowUpText).toMatch(/higher than the total time/);
  });
});

describe('stop / leave / back', () => {
  it('stop clears the queue and stops the node', async () => {
    const { player, ctx, interaction } = setup();
    await stopCommand.execute(ctx, asInteraction(interaction));
    expect(player.queue?.calls).toContain('clear');
    expect(player.queue?.calls).toContain('node.stop');
    expect(player.queue?.upcoming).toHaveLength(0);
  });

  it('leave deletes the queue', async () => {
    const { player, ctx, interaction } = setup();
    await leaveCommand.execute(ctx, asInteraction(interaction));
    expect(player.queue?.calls).toContain('delete');
    expect(player.queue?.deleted).toBe(true);
  });

  // Phase 6e (R5-C, GPT's ordering case): the invoker is authorized
  // against queue A (snapshot pre-check passes), then waits for the
  // guild lock. While they wait, the queue is replaced by queue B in
  // a channel they are not in. The in-lock fresh check must refuse —
  // B survives. The memberFetchCalls assertion pins the ORDER: no
  // fresh fetch may happen before the lock is granted.
  it('leave authorizes inside the lock: a replacement queue survives (R5-C)', async () => {
    const { player, ctx, interaction } = setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const hold = withGuildQueueLock('guild-1', () => gate);
    const pending = leaveCommand.execute(ctx, asInteraction(interaction));
    // Flush a fixed number of macrotask ticks so the command can
    // defer, pass the snapshot pre-check, and park on the lock. (The
    // fake's deferReply flips `deferred` synchronously, so waiting ON
    // that flag would swap before the command even reaches the lock.)
    for (let i = 0; i < 10; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(interaction.deferred).toBe(true);
    expect(interaction.memberFetchCalls).toHaveLength(0);

    const queueB = new FakeQueue();
    queueB.channel = { id: 'vc-2', name: 'Other' };
    player.queue = queueB;
    release();
    await pending;
    await hold;

    expect(queueB.deleted).toBe(false);
    expect(queueB.calls).not.toContain('delete');
    expect(interaction.memberFetchCalls.length).toBeGreaterThan(0); // fresh fetch ran in-lock
    expect(interaction.lastFollowUpText).toMatch(/same voice channel/);
  });

  it('back refuses without history, then goes back with history', async () => {
    const { player, ctx, interaction } = setup();
    await backCommand.execute(ctx, asInteraction(interaction));
    expect(interaction.lastFollowUpText).toMatch(/no music played before/i);

    if (player.queue !== null) player.queue.history.previousTrack = fakeTrack();
    const second = new FakeMusicInteraction();
    await backCommand.execute(ctx, asInteraction(second));
    expect(player.queue?.calls).toContain('history.back');
  });
});

describe('play command', () => {
  it('refuses direct file URLs before searching (SSRF guard)', async () => {
    const { player, ctx, interaction } = setup();
    player.queue = null;
    interaction.setOption('song', 'https://example.com/song.mp3');
    await playCommand.execute(ctx, asInteraction(interaction));
    expect(player.searchCalls).toHaveLength(0);
    expect(interaction.lastFollowUpText).toMatch(/direct file\/stream links are not allowed/);
  });

  it('searches, creates a queue, connects, and starts playback', async () => {
    const { player, ctx, interaction } = setup();
    player.queue = null;
    interaction.setOption('song', 'some song');
    await playCommand.execute(ctx, asInteraction(interaction));
    expect(player.searchCalls).toEqual(['some song']);
    expect(player.createdQueues).toHaveLength(1);
    const queue = player.createdQueues[0];
    expect(queue?.calls).toContain('connect');
    expect(queue?.calls).toContain('addTrack');
    expect(queue?.calls).toContain('node.play');
    expect(interaction.lastFollowUpText).toMatch(/Found Song/);
  });

  it('queues behind a playing track with its position', async () => {
    const { player, ctx, interaction } = setup();
    interaction.setOption('song', 'another');
    await playCommand.execute(ctx, asInteraction(interaction));
    // Default fake queue already has a current track + 2 upcoming.
    expect(player.queue?.upcoming).toHaveLength(3);
    expect(interaction.lastFollowUpText).toMatch(/position \*\*#3\*\*/);
  });

  // Phase 6 (P1-06): voice state is revalidated AFTER the awaited
  // search — leaving voice mid-search aborts the mutation entirely.
  it('aborts when the invoker leaves voice while the search is in flight', async () => {
    const { player, ctx, interaction } = setup();
    player.queue = null;
    let releaseSearch!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseSearch = resolve;
    });
    const originalSearch = player.search.bind(player);
    player.search = async (query: string) => {
      await gate;
      return originalSearch(query);
    };
    interaction.setOption('song', 'slow song');
    const running = playCommand.execute(ctx, asInteraction(interaction));
    // Let the command reach the gated search, then leave voice.
    await new Promise((resolve) => setTimeout(resolve, 10));
    interaction.setVoiceChannel(null);
    releaseSearch();
    await running;
    expect(player.createdQueues).toHaveLength(0);
    expect(interaction.lastFollowUpText).toMatch(/left the voice channel/);
  });
});

describe('playnext command', () => {
  it('inserts at the front and refuses playlists', async () => {
    const { player, ctx, interaction } = setup();
    interaction.setOption('song', 'next one');
    await playnextCommand.execute(ctx, asInteraction(interaction));
    expect(player.queue?.calls).toContain('insertTrack:0');
    expect(player.queue?.upcoming[0]?.title).toBe('Found Song');

    if (player !== null) player.searchPlaylist = { title: 'A Playlist' };
    const second = new FakeMusicInteraction().setOption('song', 'a playlist');
    await playnextCommand.execute(ctx, asInteraction(second));
    expect(second.lastFollowUpText).toMatch(/doesn't support playlists/);
  });

  // Phase 6c (R5): /playnext previously inserted against the stale
  // pre-search session — no lock, no recheck. Leaving voice during the
  // search must now abort the insert.
  it('rejects when the invoker leaves voice during the search', async () => {
    const { player, ctx, interaction } = setup();
    let releaseSearch!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseSearch = resolve;
    });
    const originalSearch = player.search.bind(player);
    player.search = async (query: string, options?: { searchEngine?: string }) => {
      await gate;
      return originalSearch(query, options);
    };
    interaction.setOption('song', 'slow next');
    const running = playnextCommand.execute(ctx, asInteraction(interaction));
    await new Promise((resolve) => setTimeout(resolve, 10));
    interaction.setVoiceChannel(null);
    releaseSearch();
    await running;
    expect(player.queue?.calls.filter((c) => c.startsWith('insertTrack'))).toHaveLength(0);
    expect(interaction.lastFollowUpText).toMatch(/not in a voice channel/i);
  });
});

// Phase 6c (R5): the freshness fetch is forced, and its failure fails
// CLOSED — the Phase 6 helper fell back to the stale snapshot.
describe('play freshness (Phase 6c, R5)', () => {
  it('force-fetches the member inside the lock', async () => {
    const { player, ctx, interaction } = setup();
    player.queue = null;
    interaction.setOption('song', 'some song');
    await playCommand.execute(ctx, asInteraction(interaction));
    expect(interaction.memberFetchCalls.length).toBeGreaterThan(0);
    for (const call of interaction.memberFetchCalls) {
      expect((call as { force?: boolean }).force).toBe(true);
    }
  });

  it('fails closed when the freshness fetch fails — no queue is created', async () => {
    const { player, ctx, interaction } = setup();
    player.queue = null;
    interaction.failMemberFetch = true;
    interaction.setOption('song', 'some song');
    await playCommand.execute(ctx, asInteraction(interaction));
    expect(player.createdQueues).toHaveLength(0);
    expect(interaction.lastFollowUpText).toMatch(/couldn't verify your voice state/i);
  });

  // Phase 6d regression (Gemini re-review): discord.js managers are
  // classes — `fetch` lives on the prototype and reads instance state
  // via `this`. checkAccessFresh originally extracted the method and
  // called it unbound, which throws a TypeError against real managers
  // and failed EVERY live /play with the verify-failed message. The
  // arrow-function fixture above cannot see that bug, so this manager
  // is a real class instance whose fetch dereferences `this`.
  it('calls members.fetch bound to the manager, like a real discord.js manager', async () => {
    const { player, ctx, interaction } = setup();
    player.queue = null;
    class FakeMemberManager {
      constructor(private readonly owner: FakeMusicInteraction) {}
      async fetch(options: unknown): Promise<unknown> {
        // Dereferencing `this` — an unbound call throws TypeError here.
        this.owner.memberFetchCalls.push(options);
        const voice = (
          this.owner.member as { voice?: { channel?: unknown; channelId?: string | null } } | null
        )?.voice;
        return { voice: { channel: voice?.channel ?? null, channelId: voice?.channelId ?? null } };
      }
    }
    (interaction.guild as { members: unknown }).members = new FakeMemberManager(interaction);
    interaction.setOption('song', 'some song');
    await playCommand.execute(ctx, asInteraction(interaction));
    expect(interaction.memberFetchCalls.length).toBeGreaterThan(0);
    expect(interaction.lastFollowUpText).not.toMatch(/couldn't verify your voice state/i);
    expect(player.createdQueues).toHaveLength(1);
  });
});

// Phase 6c (B2 / NEW-05): text search follows the extractors that are
// actually registered, with a one-shot SoundCloud fallback.
describe('search fallback (Phase 6c, B2)', () => {
  it('uses SoundCloud search when the YouTube extractor never registered', async () => {
    const { player, ctx, interaction } = setup();
    player.queue = null;
    player.extractors.store.delete(YoutubeExtractor.identifier);
    interaction.setOption('song', 'some song');
    await playCommand.execute(ctx, asInteraction(interaction));
    expect(player.searchEngines).toEqual([QueryType.SOUNDCLOUD_SEARCH]);
    expect(interaction.lastFollowUpText).toMatch(/Found Song/);
  });

  it('falls back to SoundCloud once when YouTube search throws', async () => {
    const { player, ctx, interaction } = setup();
    player.queue = null;
    player.searchEngineBehavior.set(QueryType.YOUTUBE_SEARCH, 'throw');
    interaction.setOption('song', 'some song');
    await playCommand.execute(ctx, asInteraction(interaction));
    expect(player.searchEngines).toEqual([QueryType.YOUTUBE_SEARCH, QueryType.SOUNDCLOUD_SEARCH]);
    expect(interaction.lastFollowUpText).toMatch(/Found Song/);
  });

  it('falls back to SoundCloud once when YouTube search comes back empty', async () => {
    const { player, ctx, interaction } = setup();
    player.queue = null;
    player.searchEngineBehavior.set(QueryType.YOUTUBE_SEARCH, 'empty');
    interaction.setOption('song', 'some song');
    await playCommand.execute(ctx, asInteraction(interaction));
    expect(player.searchEngines).toEqual([QueryType.YOUTUBE_SEARCH, QueryType.SOUNDCLOUD_SEARCH]);
    expect(interaction.lastFollowUpText).toMatch(/Found Song/);
  });

  it('passes the NORMALIZED url to the player for protocol-relative input', async () => {
    const { player, ctx, interaction } = setup();
    player.queue = null;
    interaction.setOption('song', '//www.youtube.com/watch?v=x');
    await playCommand.execute(ctx, asInteraction(interaction));
    expect(player.searchCalls).toEqual(['https://www.youtube.com/watch?v=x']);
    expect(player.searchEngines).toEqual([QueryType.YOUTUBE_VIDEO]);
  });

  it('plays OST-style titles containing colons as searches', async () => {
    const { player, ctx, interaction } = setup();
    player.queue = null;
    interaction.setOption('song', 'Re:Zero OST');
    await playCommand.execute(ctx, asInteraction(interaction));
    expect(player.searchCalls).toEqual(['Re:Zero OST']);
    expect(interaction.lastFollowUpText).toMatch(/Found Song/);
  });
});

describe('search command', () => {
  it('stores a session and replies with a select menu', async () => {
    const { ctx, interaction } = setup();
    interaction.setOption('song', 'find me');
    await searchCommand.execute(ctx, asInteraction(interaction));
    const session = searchSessions.get('interaction-1');
    expect(session?.userId).toBe('user-1');
    expect(session?.tracks).toHaveLength(1);
    const components = interaction.lastFollowUp.components as
      { components: { data: { custom_id?: string } }[] }[] | undefined;
    const menu = components?.[0]?.components[0];
    expect(menu?.data.custom_id).toBe('music:select:interaction-1');
  });
});

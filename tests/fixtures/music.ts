import { SoundCloudExtractor } from '@discord-player/extractor';
import type { Player, Track } from 'discord-player';
import { YoutubeExtractor } from 'discord-player-youtubei';
import type { AppContext } from '../../src/core/context.js';
import type { MusicQueue } from '../../src/features/music/queue.js';
import { makeCtx } from './fakes.js';

/** Plain-data track factory; cast to the discord-player Track shape. */
export function fakeTrack(overrides: Partial<Record<string, unknown>> = {}): Track {
  return {
    title: 'Test Song',
    author: 'Test Artist',
    url: 'https://www.youtube.com/watch?v=test',
    thumbnail: 'https://example.com/thumb.jpg',
    duration: '3:45',
    durationMS: 225_000,
    seekable: true,
    views: 0,
    live: false,
    requestedBy: { username: 'requester' },
    ...overrides,
  } as unknown as Track;
}

/**
 * Structural GuildQueue fake: just the surface the music commands,
 * components, guards, and snapshots touch, with call recording. All
 * nested methods are arrow functions so `this` stays the FakeQueue.
 */
export class FakeQueue {
  metadata: unknown = null;
  deleted = false;
  repeatMode = 0;
  currentTrack: Track | null = fakeTrack();
  connection: object | null = { fake: true };
  channel: { id: string; name: string } | null = { id: 'vc-1', name: 'General' };
  readonly upcoming: Track[] = [fakeTrack({ title: 'Second' }), fakeTrack({ title: 'Third' })];
  readonly calls: string[] = [];
  #paused = false;
  #volume = 75;

  readonly tracks = {
    get size(): number {
      return 0; // redefined against `upcoming` in the constructor
    },
    toArray: (): Track[] => [...this.upcoming],
    at: (index: number): Track | undefined => this.upcoming[index],
    shuffle: (): void => {
      this.calls.push('tracks.shuffle');
      this.upcoming.reverse();
    },
  };

  readonly node = {
    get volume(): number {
      return 0; // redefined against #volume in the constructor
    },
    isPaused: (): boolean => this.#paused,
    pause: (): boolean => {
      this.calls.push('node.pause');
      this.#paused = true;
      return true;
    },
    resume: (): boolean => {
      this.calls.push('node.resume');
      this.#paused = false;
      return true;
    },
    skip: (): boolean => {
      this.calls.push('node.skip');
      return true;
    },
    stop: (): boolean => {
      this.calls.push('node.stop');
      return true;
    },
    seek: async (ms: number): Promise<boolean> => {
      this.calls.push(`node.seek:${ms}`);
      return true;
    },
    setVolume: (vol: number): boolean => {
      this.calls.push(`node.setVolume:${vol}`);
      this.#volume = vol;
      return true;
    },
    play: async (): Promise<void> => {
      this.calls.push('node.play');
    },
    createProgressBar: (): string => '▬▬🔘▬▬ 1:00 / 3:45',
  };

  readonly history = {
    previousTrack: null as Track | null,
    back: async (): Promise<void> => {
      this.calls.push('history.back');
    },
  };

  constructor() {
    Object.defineProperty(this.tracks, 'size', {
      get: () => this.upcoming.length,
    });
    Object.defineProperty(this.node, 'volume', {
      get: () => this.#volume,
    });
  }

  setPaused(paused: boolean): void {
    this.#paused = paused;
  }

  isPlaying(): boolean {
    return this.currentTrack !== null;
  }

  setMetadata(metadata: unknown): void {
    this.metadata = metadata;
  }

  async connect(): Promise<this> {
    this.calls.push('connect');
    this.connection = { fake: true };
    return this;
  }

  addTrack(track: Track | Track[]): void {
    this.calls.push('addTrack');
    if (Array.isArray(track)) this.upcoming.push(...track);
    else this.upcoming.push(track);
  }

  insertTrack(track: Track, index: number): void {
    this.calls.push(`insertTrack:${index}`);
    this.upcoming.splice(index, 0, track);
  }

  removeTrack(track: Track): Track | null {
    this.calls.push('removeTrack');
    const index = this.upcoming.indexOf(track);
    if (index === -1) return null;
    this.upcoming.splice(index, 1);
    return track;
  }

  moveTrack(track: Track, index: number): void {
    this.calls.push(`moveTrack:${index}`);
    const from = this.upcoming.indexOf(track);
    if (from === -1) return;
    this.upcoming.splice(from, 1);
    this.upcoming.splice(index, 0, track);
  }

  clear(): void {
    this.calls.push('clear');
    this.upcoming.length = 0;
  }

  delete(): void {
    this.calls.push('delete');
    this.deleted = true;
  }

  setRepeatMode(mode: number): void {
    this.calls.push(`setRepeatMode:${mode}`);
    this.repeatMode = mode;
  }
}

/** Player fake: one optional queue + a stubbed search. */
export class FakePlayer {
  queue: FakeQueue | null = new FakeQueue();
  createdQueues: FakeQueue[] = [];
  searchCalls: string[] = [];
  /** The searchEngine option of each search call, in order (Phase 6c, B2). */
  searchEngines: (string | undefined)[] = [];
  searchTracksResult: Track[] = [fakeTrack({ title: 'Found Song' })];
  searchPlaylist: { title: string } | null = null;
  /** Per-engine search behavior: 'throw' or 'empty' (Phase 6c, B2). */
  readonly searchEngineBehavior = new Map<string, 'throw' | 'empty'>();

  /**
   * Extractor registry fake (Phase 6c, B2): both the YouTube and
   * SoundCloud extractors registered by default; tests delete entries
   * to simulate a boot where an extractor failed to register.
   */
  readonly extractors = {
    store: new Map<string, object>([
      [YoutubeExtractor.identifier, {}],
      [SoundCloudExtractor.identifier, {}],
    ]),
  };

  readonly nodes = {
    get: (): FakeQueue | null => this.queue,
    create: (_guildId: string, options: { metadata: unknown }): FakeQueue => {
      const queue = new FakeQueue();
      queue.upcoming.length = 0;
      queue.currentTrack = null;
      queue.connection = null;
      queue.setMetadata(options.metadata);
      this.queue = queue;
      this.createdQueues.push(queue);
      return queue;
    },
  };

  async search(
    query: string,
    options?: { searchEngine?: string },
  ): Promise<{
    tracks: Track[];
    playlist: { title: string } | null;
    isEmpty: () => boolean;
    hasPlaylist: () => boolean;
  }> {
    this.searchCalls.push(query);
    const engine = options?.searchEngine;
    this.searchEngines.push(engine);
    const behavior = engine === undefined ? undefined : this.searchEngineBehavior.get(engine);
    if (behavior === 'throw') throw new Error(`search failed on ${engine}`);
    const tracks = behavior === 'empty' ? [] : this.searchTracksResult;
    const playlist = this.searchPlaylist;
    return {
      tracks,
      playlist,
      isEmpty: () => tracks.length === 0,
      hasPlaylist: () => playlist !== null,
    };
  }
}

export function makeMusicCtx(player: FakePlayer): AppContext {
  return makeCtx({ player: player as unknown as Player });
}

export function asQueue(queue: FakeQueue): MusicQueue {
  return queue as unknown as MusicQueue;
}

interface RecordedCall {
  readonly method: string;
  readonly options: unknown;
}

/** Chat-input interaction fake wired for music commands. */
export class FakeMusicInteraction {
  id = 'interaction-1';
  commandName = 'skip';
  guildId: string | null = 'guild-1';
  user = { id: 'user-1', username: 'invoker' };
  /** Set true to make guild.members.fetch reject (Phase 6c, R5). */
  failMemberFetch = false;
  /** Every members.fetch argument, in order (assert force:true, R5). */
  readonly memberFetchCalls: unknown[] = [];
  guild: unknown;
  member: unknown = {
    voice: { channel: { id: 'vc-1', name: 'General' }, channelId: 'vc-1' },
  };

  constructor() {
    // members.fetch mirrors the fake's CURRENT member voice state, the
    // way a force-refetch would observe it (Phase 6c, R5 fixtures).
    this.guild = {
      name: 'Test Guild',
      members: {
        me: { voice: { channelId: 'vc-1' } },
        fetch: async (options: unknown): Promise<unknown> => {
          this.memberFetchCalls.push(options);
          if (this.failMemberFetch) throw new Error('member fetch failed');
          const voice = (
            this.member as { voice?: { channel?: unknown; channelId?: string | null } } | null
          )?.voice;
          return {
            voice: { channel: voice?.channel ?? null, channelId: voice?.channelId ?? null },
          };
        },
      },
    };
  }
  channel: unknown = {
    send: async () => ({}),
  };
  memberPermissions = null;
  replied = false;
  deferred = false;
  readonly calls: RecordedCall[] = [];
  readonly #options = new Map<string, unknown>();

  setOption(name: string, value: unknown): this {
    this.#options.set(name, value);
    return this;
  }

  readonly options = {
    getString: (name: string): string | null =>
      (this.#options.get(name) as string | undefined) ?? null,
    getInteger: (name: string): number | null =>
      (this.#options.get(name) as number | undefined) ?? null,
    getNumber: (name: string): number | null =>
      (this.#options.get(name) as number | undefined) ?? null,
    getUser: (): null => null,
  };

  setVoiceChannel(channelId: string | null): void {
    this.member = {
      voice: {
        channel: channelId === null ? null : { id: channelId, name: 'General' },
        channelId,
      },
    };
  }

  async reply(options: unknown): Promise<unknown> {
    this.calls.push({ method: 'reply', options });
    this.replied = true;
    return {};
  }

  async editReply(options: unknown): Promise<unknown> {
    this.calls.push({ method: 'editReply', options });
    this.replied = true;
    return {};
  }

  async followUp(options: unknown): Promise<unknown> {
    this.calls.push({ method: 'followUp', options });
    return {};
  }

  async deferReply(): Promise<unknown> {
    this.calls.push({ method: 'deferReply', options: undefined });
    this.deferred = true;
    return {};
  }

  /**
   * The last response payload (Phase 6: commands answer via editReply —
   * the deferred reply IS the response — so this reads the newest of
   * editReply/followUp), typed loosely for assertions.
   */
  get lastFollowUp(): {
    content?: string;
    embeds?: { data: { description?: string; title?: string } }[];
    components?: unknown[];
  } {
    const call = [...this.calls]
      .reverse()
      .find((c) => c.method === 'editReply' || c.method === 'followUp');
    return call?.options ?? {};
  }

  /** Text the user would see from the last response (content or embed description). */
  get lastFollowUpText(): string {
    const payload = this.lastFollowUp;
    if (typeof payload.content === 'string') return payload.content;
    return payload.embeds?.[0]?.data.description ?? '';
  }
}

/** Component interaction fake (buttons + select menus). */
export class FakeMusicComponentInteraction {
  customId = 'music:skip';
  guildId: string | null = 'guild-1';
  /** DM payloads sent via user.send (save-track button); set failSend to simulate closed DMs. */
  readonly sentDMs: unknown[] = [];
  failSend = false;
  user = {
    id: 'user-1',
    username: 'invoker',
    send: async (options: unknown): Promise<unknown> => {
      if (this.failSend) throw new Error('Cannot send messages to this user');
      this.sentDMs.push(options);
      return {};
    },
  };
  /** Set true to make guild.members.fetch reject (Phase 6c, R5). */
  failMemberFetch = false;
  /** Every members.fetch argument, in order (assert force:true, R5). */
  readonly memberFetchCalls: unknown[] = [];
  guild: unknown;
  member: unknown = {
    voice: { channel: { id: 'vc-1', name: 'General' }, channelId: 'vc-1' },
  };

  constructor() {
    // members.fetch mirrors the fake's CURRENT member voice state, the
    // way a force-refetch would observe it (Phase 6c, R5 fixtures).
    this.guild = {
      name: 'Test Guild',
      members: {
        me: { voice: { channelId: 'vc-1' } },
        fetch: async (options: unknown): Promise<unknown> => {
          this.memberFetchCalls.push(options);
          if (this.failMemberFetch) throw new Error('member fetch failed');
          const voice = (
            this.member as { voice?: { channel?: unknown; channelId?: string | null } } | null
          )?.voice;
          return {
            voice: { channel: voice?.channel ?? null, channelId: voice?.channelId ?? null },
          };
        },
      },
    };
  }
  channel: unknown = { send: async () => ({}) };
  values: string[] = [];
  replied = false;
  deferred = false;
  readonly calls: RecordedCall[] = [];

  isStringSelectMenu(): boolean {
    return this.customId.startsWith('music:select');
  }

  setVoiceChannel(channelId: string | null): void {
    this.member = {
      voice: {
        channel: channelId === null ? null : { id: channelId, name: 'General' },
        channelId,
      },
    };
  }

  async reply(options: unknown): Promise<unknown> {
    this.calls.push({ method: 'reply', options });
    this.replied = true;
    return {};
  }

  async editReply(options: unknown): Promise<unknown> {
    this.calls.push({ method: 'editReply', options });
    this.replied = true;
    return {};
  }

  async followUp(options: unknown): Promise<unknown> {
    this.calls.push({ method: 'followUp', options });
    return {};
  }

  async deferReply(): Promise<unknown> {
    this.calls.push({ method: 'deferReply', options: undefined });
    this.deferred = true;
    return {};
  }

  async deferUpdate(): Promise<unknown> {
    this.calls.push({ method: 'deferUpdate', options: undefined });
    this.deferred = true;
    return {};
  }

  async update(options: unknown): Promise<unknown> {
    this.calls.push({ method: 'update', options });
    this.replied = true;
    return {};
  }

  /**
   * The newest user-visible text across reply / editReply / followUp
   * (Phase 6c: deferred components now confirm via editReply, so a
   * reply-only read would miss their confirmations).
   */
  get lastReplyText(): string {
    const call = [...this.calls]
      .reverse()
      .find((c) => c.method === 'reply' || c.method === 'editReply' || c.method === 'followUp');
    const options = (call?.options ?? {}) as { content?: string };
    return options.content ?? '';
  }
}

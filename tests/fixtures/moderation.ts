import { Writable } from 'node:stream';
import { DiscordAPIError, PermissionsBitField } from 'discord.js';
import { pino, type Logger } from 'pino';

/**
 * Hand-rolled Discord fakes for moderation tests — guilds, members, and
 * interactions with every API call recorded, plus a pino logger that
 * captures structured entries for audit-log assertions. No network.
 */

/** Build a real DiscordAPIError with the given REST JSON error code. */
export function discordApiError(code: number, message = 'fake discord error'): DiscordAPIError {
  return new DiscordAPIError(
    { message, code },
    code,
    404,
    'GET',
    'https://discord.com/api/v10/fake',
    {
      files: undefined,
      body: undefined,
    },
  );
}

export interface FakeMemberOptions {
  readonly id: string;
  readonly rolePosition?: number;
  readonly permissions?: bigint;
  readonly communicationDisabled?: boolean;
}

export class FakeMember {
  readonly id: string;
  readonly roles: { highest: { position: number } };
  readonly permissions: PermissionsBitField;
  guild: FakeGuild | null = null;
  readonly kickCalls: (string | undefined)[] = [];
  readonly timeoutCalls: { duration: number | null; reason: string | undefined }[] = [];
  communicationDisabledUntilTimestamp: number | null = null;
  private disabled: boolean;

  constructor(options: FakeMemberOptions) {
    this.id = options.id;
    this.roles = { highest: { position: options.rolePosition ?? 0 } };
    this.permissions = new PermissionsBitField(options.permissions ?? 0n);
    this.disabled = options.communicationDisabled ?? false;
    if (this.disabled) {
      this.communicationDisabledUntilTimestamp = Date.now() + 60_000;
    }
  }

  async kick(reason?: string): Promise<this> {
    this.kickCalls.push(reason);
    return this;
  }

  async timeout(duration: number | null, reason?: string): Promise<this> {
    this.timeoutCalls.push({ duration, reason });
    this.disabled = duration !== null;
    this.communicationDisabledUntilTimestamp = duration === null ? null : Date.now() + duration;
    return this;
  }

  isCommunicationDisabled(): boolean {
    return this.disabled;
  }
}

export interface BanCall {
  readonly id: string;
  readonly options: unknown;
}

export class FakeGuild {
  readonly id: string;
  readonly ownerId: string;
  private readonly memberMap = new Map<string, FakeMember>();
  /** When set, members.fetch throws this instead of resolving. */
  fetchError: unknown = undefined;
  /** When set, bans.remove throws this after recording the call. */
  banRemoveError: unknown = undefined;
  readonly memberBanCalls: BanCall[] = [];
  readonly banCreateCalls: BanCall[] = [];
  readonly banRemoveCalls: { id: string; reason: string | undefined }[] = [];

  readonly members: {
    me: FakeMember | null;
    fetch: (options: { user: string; force?: boolean }) => Promise<FakeMember>;
    /** Phase 6 (G7): the guards fetch the bot member fresh via fetchMe. */
    fetchMe: (options?: { force?: boolean }) => Promise<FakeMember>;
    ban: (id: string, options?: unknown) => Promise<void>;
  };

  readonly bans: {
    create: (id: string, options?: unknown) => Promise<void>;
    remove: (id: string, reason?: string) => Promise<void>;
  };

  constructor(
    ownerId: string,
    bot: FakeMember | null,
    members: readonly FakeMember[],
    id = 'guild-1',
  ) {
    this.id = id;
    this.ownerId = ownerId;
    for (const member of members) {
      member.guild = this;
      this.memberMap.set(member.id, member);
    }
    if (bot !== null) bot.guild = this;

    this.members = {
      me: bot,
      fetch: async (options) => {
        if (this.fetchError !== undefined) throw this.fetchError;
        const member = this.memberMap.get(options.user);
        if (member === undefined) {
          throw discordApiError(10007, 'Unknown Member');
        }
        return member;
      },
      fetchMe: async () => {
        if (this.fetchError !== undefined) throw this.fetchError;
        if (bot === null) {
          throw discordApiError(10007, 'Unknown Member');
        }
        return bot;
      },
      ban: async (id, options) => {
        this.memberBanCalls.push({ id, options });
      },
    };

    this.bans = {
      create: async (id, options) => {
        this.banCreateCalls.push({ id, options });
      },
      remove: async (id, reason) => {
        this.banRemoveCalls.push({ id, reason });
        if (this.banRemoveError !== undefined) throw this.banRemoveError;
      },
    };
  }

  member(id: string): FakeMember | undefined {
    return this.memberMap.get(id);
  }

  /** Add a member to the guild (sets its guild back-reference). */
  register(member: FakeMember): FakeMember {
    member.guild = this;
    this.memberMap.set(member.id, member);
    return member;
  }
}

export interface FakeUser {
  readonly id: string;
  readonly username: string;
  readonly bot: boolean;
}

export function fakeUser(id: string, username = `user-${id}`): FakeUser {
  return { id, username, bot: false };
}

export interface RecordedResponse {
  readonly method: 'reply' | 'editReply' | 'followUp' | 'deferReply';
  readonly options: unknown;
}

export interface FakeInteractionSpec {
  readonly commandName?: string;
  readonly user?: FakeUser;
  readonly guild?: FakeGuild | null;
  readonly member?: FakeMember | null;
  readonly optionUser?: FakeUser | null;
  readonly strings?: Readonly<Record<string, string | null>>;
  readonly integers?: Readonly<Record<string, number | null>>;
  readonly booleans?: Readonly<Record<string, boolean | null>>;
}

/** Fabricated chat-input interaction for moderation/utility/admin commands. */
export class FakeInteraction {
  readonly id = 'interaction-1';
  readonly commandName: string;
  readonly guildId: string | null = 'guild-1';
  readonly channelId = 'channel-1';
  readonly user: FakeUser;
  readonly guild: FakeGuild | null;
  readonly member: FakeMember | null;
  readonly options: {
    getUser: (name: string) => FakeUser | null;
    getString: (name: string) => string | null;
    getInteger: (name: string) => number | null;
    getBoolean: (name: string) => boolean | null;
  };
  replied = false;
  deferred = false;
  readonly calls: RecordedResponse[] = [];

  constructor(spec: FakeInteractionSpec = {}) {
    this.commandName = spec.commandName ?? 'test';
    this.user = spec.user ?? fakeUser('mod-1');
    this.guild = spec.guild ?? null;
    this.member = spec.member ?? null;
    const optionUser = spec.optionUser ?? null;
    const strings = spec.strings ?? {};
    const integers = spec.integers ?? {};
    const booleans = spec.booleans ?? {};
    this.options = {
      getUser: (name) => (name === 'user' || name === 'member' ? optionUser : null),
      getString: (name) => strings[name] ?? null,
      getInteger: (name) => integers[name] ?? null,
      getBoolean: (name) => booleans[name] ?? null,
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

  async deferReply(options?: unknown): Promise<unknown> {
    this.calls.push({ method: 'deferReply', options });
    this.deferred = true;
    return {};
  }

  /** Response calls that put content in front of the user. */
  get surfaces(): RecordedResponse[] {
    return this.calls.filter((call) => call.method !== 'deferReply');
  }

  /** Embed JSON of the most recent surface, if it carried embeds. */
  lastEmbed(): Record<string, unknown> | undefined {
    const surface = this.surfaces.at(-1);
    if (surface === undefined) return undefined;
    const options = surface.options as { embeds?: { toJSON: () => Record<string, unknown> }[] };
    return options.embeds?.[0]?.toJSON();
  }
}

/** A pino logger writing JSON lines into memory for assertions. */
export function capturingLogger(): {
  logger: Logger;
  entries: () => Record<string, unknown>[];
} {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  const logger = pino({ level: 'trace' }, stream);
  return {
    logger,
    entries: () =>
      chunks
        .join('')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

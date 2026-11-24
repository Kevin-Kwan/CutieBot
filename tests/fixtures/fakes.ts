import type { Player } from 'discord-player';
import type { Client } from 'discord.js';
import type { AppConfig } from '../../src/config/env.js';
import type { AppContext, DbHandles } from '../../src/core/context.js';
import { CooldownStore } from '../../src/core/cooldowns.js';
import { createLogger } from '../../src/core/logger.js';
import { createRegistry } from '../../src/core/registry.js';

/** Build a minimal AppContext for router/handler tests — no network, no DB. */
export function makeCtx(overrides: Partial<AppContext> = {}): AppContext {
  const config: AppConfig = {
    discordToken: 'test-token',
    clientId: 'test-client',
    mongoUri: 'mongodb://127.0.0.1:27017/test',
    guildId: undefined,
    ownerId: 'owner-1',
    openaiApiKey: undefined,
    openaiModel: 'gpt-4o-mini',
    youtubeCookie: undefined,
    logLevel: 'silent',
    aiPerUserDailyCap: 50,
    aiGlobalDailyCap: 500,
  };
  const base: AppContext = {
    client: {} as unknown as Client,
    player: {} as unknown as Player,
    db: {} as unknown as DbHandles,
    config,
    logger: createLogger('silent'),
    registry: createRegistry(),
    cooldowns: new CooldownStore(),
  };
  return { ...base, ...overrides };
}

export interface RecordedCall {
  readonly method: 'reply' | 'editReply' | 'followUp' | 'deferReply';
  readonly options: unknown;
}

/**
 * Hand-rolled chat-input interaction fake. Records every response call so
 * tests can assert the router surfaces exactly one error reply.
 */
export class FakeChatInputInteraction {
  commandName = 'test';
  guildId: string | null = 'guild-1';
  user = { id: 'user-1' };
  memberPermissions: { has: (perms: readonly (bigint | string)[]) => boolean } | null = null;
  replied = false;
  deferred = false;
  readonly calls: RecordedCall[] = [];
  /** When set, reply() throws this value (e.g. a 10062 unknown interaction). */
  replyError: unknown = undefined;
  /** When set, deferReply() throws this value. */
  deferError: unknown = undefined;

  isChatInputCommand(): boolean {
    return true;
  }
  isAutocomplete(): boolean {
    return false;
  }
  isMessageComponent(): boolean {
    return false;
  }

  async reply(options: unknown): Promise<unknown> {
    this.calls.push({ method: 'reply', options });
    if (this.replyError !== undefined) throw this.replyError;
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
    if (this.deferError !== undefined) throw this.deferError;
    this.deferred = true;
    return {};
  }

  /** All calls that put content in front of the user. */
  get surfaces(): RecordedCall[] {
    return this.calls.filter((call) => call.method !== 'deferReply');
  }
}

/** Hand-rolled message-component interaction fake. */
export class FakeComponentInteraction {
  customId = 'music:skip';
  guildId: string | null = 'guild-1';
  user = { id: 'user-1' };
  replied = false;
  deferred = false;
  readonly calls: RecordedCall[] = [];

  isChatInputCommand(): boolean {
    return false;
  }
  isAutocomplete(): boolean {
    return false;
  }
  isMessageComponent(): boolean {
    return true;
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
}

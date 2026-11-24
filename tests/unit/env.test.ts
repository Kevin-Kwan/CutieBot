import { EnvError, loadConfig } from '../../src/config/env.js';
import { describe, expect, it } from 'vitest';

const FULL = {
  DISCORD_TOKEN: 'token',
  CLIENT_ID: '123456789012345678',
  MONGO_URI: 'mongodb://127.0.0.1:27017/cutiebot',
};

describe('loadConfig', () => {
  it('throws listing ALL missing required variables at once', () => {
    let caught: unknown;
    try {
      loadConfig({});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EnvError);
    const envError = caught as EnvError;
    expect(envError.missing).toEqual(['DISCORD_TOKEN', 'CLIENT_ID', 'MONGO_URI']);
    expect(envError.message).toContain('DISCORD_TOKEN');
    expect(envError.message).toContain('CLIENT_ID');
    expect(envError.message).toContain('MONGO_URI');
  });

  it('treats empty / whitespace values as missing', () => {
    expect(() => loadConfig({ ...FULL, DISCORD_TOKEN: '   ' })).toThrow(EnvError);
  });

  it('never leaks secret values into the error message', () => {
    try {
      loadConfig({ DISCORD_TOKEN: 'super-secret-value' });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain('super-secret-value');
    }
  });

  it('applies defaults for optional variables', () => {
    const config = loadConfig({ ...FULL });
    expect(config.discordToken).toBe('token');
    expect(config.guildId).toBeUndefined();
    expect(config.ownerId).toBeUndefined();
    expect(config.openaiApiKey).toBeUndefined();
    expect(config.youtubeCookie).toBeUndefined();
    expect(config.openaiModel).toBe('gpt-4o-mini');
    expect(config.logLevel).toBe('info');
  });

  it('reads optional variables when present', () => {
    const config = loadConfig({
      ...FULL,
      GUILD_ID: '234567890123456789',
      OWNER_ID: '345678901234567890',
      OPENAI_API_KEY: 'sk-test',
      OPENAI_MODEL: 'gpt-4o',
      YOUTUBE_COOKIE: 'cookie-value',
      LOG_LEVEL: 'debug',
    });
    expect(config.guildId).toBe('234567890123456789');
    expect(config.ownerId).toBe('345678901234567890');
    expect(config.openaiApiKey).toBe('sk-test');
    expect(config.openaiModel).toBe('gpt-4o');
    expect(config.youtubeCookie).toBe('cookie-value');
    expect(config.logLevel).toBe('debug');
  });

  // Phase 6 (P3/G15): format validation, not just presence.
  it('rejects a non-snowflake CLIENT_ID and malformed optional IDs', () => {
    expect(() => loadConfig({ ...FULL, CLIENT_ID: 'not-an-id' })).toThrow(EnvError);
    expect(() => loadConfig({ ...FULL, GUILD_ID: 'guild-9' })).toThrow(/GUILD_ID/);
    expect(() => loadConfig({ ...FULL, OWNER_ID: 'owner-9' })).toThrow(/OWNER_ID/);
  });

  it('rejects an unknown LOG_LEVEL instead of dying inside pino at boot', () => {
    expect(() => loadConfig({ ...FULL, LOG_LEVEL: 'chatty' })).toThrow(/LOG_LEVEL/);
    expect(loadConfig({ ...FULL, LOG_LEVEL: 'silent' }).logLevel).toBe('silent');
  });

  // Phase 6 (P1-10 + orchestrator ruling 2): AI caps are operator config.
  it('defaults the AI daily caps to 50 per-user / 500 global', () => {
    const config = loadConfig({ ...FULL });
    expect(config.aiPerUserDailyCap).toBe(50);
    expect(config.aiGlobalDailyCap).toBe(500);
  });

  it('reads AI caps from the environment, including 0 (feature off)', () => {
    const config = loadConfig({
      ...FULL,
      AI_PER_USER_DAILY_CAP: '5',
      AI_GLOBAL_DAILY_CAP: '0',
    });
    expect(config.aiPerUserDailyCap).toBe(5);
    expect(config.aiGlobalDailyCap).toBe(0);
  });

  it('rejects negative, fractional, and non-numeric AI caps', () => {
    expect(() => loadConfig({ ...FULL, AI_PER_USER_DAILY_CAP: '-1' })).toThrow(
      /AI_PER_USER_DAILY_CAP/,
    );
    expect(() => loadConfig({ ...FULL, AI_GLOBAL_DAILY_CAP: '1.5' })).toThrow(
      /AI_GLOBAL_DAILY_CAP/,
    );
    expect(() => loadConfig({ ...FULL, AI_GLOBAL_DAILY_CAP: 'many' })).toThrow(EnvError);
  });
});

/**
 * Validated environment loading (PLAN §11).
 *
 * Required variables fail fast at boot with ALL problems listed at once.
 * Optional variables degrade gracefully: features that need them (OpenAI,
 * YouTube cookie) check for their presence instead of blocking boot.
 * Secret values are never logged or included in error messages.
 *
 * Phase 6: presence-only checks were not enough (AUDIT6 P3 / G15) —
 * snowflake-shaped IDs and LOG_LEVEL are format-validated, and the AI
 * daily caps moved here from hardcoded constants (orchestrator ruling:
 * AUDIT6 P1-10 deviation, caps belong in operator config).
 */
import { TrustedMessageError } from '../core/errors.js';
export interface AppConfig {
  readonly discordToken: string;
  readonly clientId: string;
  readonly mongoUri: string;
  readonly guildId: string | undefined;
  readonly ownerId: string | undefined;
  readonly openaiApiKey: string | undefined;
  readonly openaiModel: string;
  readonly youtubeCookie: string | undefined;
  readonly logLevel: string;
  /** Max AI requests per user per UTC day (AI_PER_USER_DAILY_CAP). */
  readonly aiPerUserDailyCap: number;
  /** Max AI requests across all users per UTC day (AI_GLOBAL_DAILY_CAP). */
  readonly aiGlobalDailyCap: number;
}

export class EnvError extends TrustedMessageError {
  readonly missing: readonly string[];
  readonly invalid: readonly string[];

  constructor(missing: readonly string[], invalid: readonly string[] = []) {
    const parts: string[] = [];
    if (missing.length > 0) {
      parts.push(`Missing required environment variables: ${missing.join(', ')}.`);
    }
    if (invalid.length > 0) {
      parts.push(`Invalid environment variables: ${invalid.join(', ')}.`);
    }
    super(`${parts.join(' ')} Copy .env.example to .env and fill it in.`);
    this.name = 'EnvError';
    this.missing = missing;
    this.invalid = invalid;
  }
}

const REQUIRED = ['DISCORD_TOKEN', 'CLIENT_ID', 'MONGO_URI'] as const;

export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
export const DEFAULT_LOG_LEVEL = 'info';
export const DEFAULT_AI_PER_USER_DAILY_CAP = 50;
export const DEFAULT_AI_GLOBAL_DAILY_CAP = 500;

/** Pino level labels (plus 'silent'); anything else is a boot error (G15). */
export const VALID_LOG_LEVELS: readonly string[] = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
  'silent',
];

/** Discord snowflake: 17–20 digit decimal, no leading zero. */
const SNOWFLAKE_PATTERN = /^[1-9]\d{16,19}$/;

function read(source: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = source[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function parseCap(
  source: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  invalid: string[],
): number {
  const raw = read(source, name);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) {
    invalid.push(`${name} (must be a non-negative integer)`);
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    invalid.push(`${name} (too large)`);
    return fallback;
  }
  return value;
}

function checkSnowflake(
  source: NodeJS.ProcessEnv,
  name: string,
  invalid: string[],
): string | undefined {
  const value = read(source, name);
  if (value !== undefined && !SNOWFLAKE_PATTERN.test(value)) {
    invalid.push(`${name} (must be a Discord snowflake ID)`);
  }
  return value;
}

/**
 * Build a validated config from an environment source (defaults to
 * process.env so tests can pass a fake source).
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const missing = REQUIRED.filter((name) => read(source, name) === undefined);
  const invalid: string[] = [];

  const clientId = checkSnowflake(source, 'CLIENT_ID', invalid);
  const guildId = checkSnowflake(source, 'GUILD_ID', invalid);
  const ownerId = checkSnowflake(source, 'OWNER_ID', invalid);

  const logLevel = read(source, 'LOG_LEVEL') ?? DEFAULT_LOG_LEVEL;
  if (!VALID_LOG_LEVELS.includes(logLevel)) {
    invalid.push(`LOG_LEVEL (must be one of: ${VALID_LOG_LEVELS.join(', ')})`);
  }

  const aiPerUserDailyCap = parseCap(
    source,
    'AI_PER_USER_DAILY_CAP',
    DEFAULT_AI_PER_USER_DAILY_CAP,
    invalid,
  );
  const aiGlobalDailyCap = parseCap(
    source,
    'AI_GLOBAL_DAILY_CAP',
    DEFAULT_AI_GLOBAL_DAILY_CAP,
    invalid,
  );

  if (missing.length > 0 || invalid.length > 0) {
    throw new EnvError(missing, invalid);
  }

  // Non-null assertions are safe: REQUIRED was just verified above.
  return {
    discordToken: read(source, 'DISCORD_TOKEN') as string,
    clientId: clientId as string,
    mongoUri: read(source, 'MONGO_URI') as string,
    guildId,
    ownerId,
    openaiApiKey: read(source, 'OPENAI_API_KEY'),
    openaiModel: read(source, 'OPENAI_MODEL') ?? DEFAULT_OPENAI_MODEL,
    youtubeCookie: read(source, 'YOUTUBE_COOKIE'),
    logLevel,
    aiPerUserDailyCap,
    aiGlobalDailyCap,
  };
}

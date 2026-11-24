import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { REST, Routes } from 'discord.js';
import { buildRegistry } from '../src/features/index.js';

/**
 * Command registration script (PLAN §4).
 *
 *   npm run commands:deploy -- --dry-run          # print payload, no network
 *   npm run commands:deploy -- --guild <id>       # register to one guild (fast)
 *   npm run commands:deploy -- --global           # register globally (slow to propagate)
 *
 * Registration is a standalone REST bulk overwrite — it never runs on bot
 * boot (the old bot cleared and re-registered everything on every ready).
 * Needs only Discord credentials (DISCORD_TOKEN + CLIENT_ID in .env).
 * The last real payload is saved to .last-deploy.json for rollback.
 */

export interface DeployOptions {
  readonly guildId: string | undefined;
  readonly global: boolean;
  readonly dryRun: boolean;
}

export function parseArgs(argv: readonly string[]): DeployOptions {
  let guildId: string | undefined;
  let global = false;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--dry-run':
        dryRun = true;
        break;
      case '--global':
        global = true;
        break;
      case '--guild': {
        const value = argv[i + 1];
        if (value === undefined || value.startsWith('--')) {
          throw new Error('--guild requires a guild ID value');
        }
        guildId = value;
        i++;
        break;
      }
      default:
        throw new Error(`Unknown argument: ${String(arg)}`);
    }
  }

  if (global && guildId !== undefined) {
    throw new Error('Pass either --global or --guild, not both');
  }
  return { guildId, global, dryRun };
}

const COMMAND_NAME_PATTERN = /^[a-z0-9_-]{1,32}$/;

/**
 * Validate a serialized command payload against Discord's limits.
 * Throws on an empty manifest (refusing to wipe registrations), malformed
 * entries, or limit violations.
 */
export function validatePayload(payload: readonly unknown[]): void {
  if (payload.length === 0) {
    throw new Error('Refusing to deploy an empty command manifest');
  }
  if (payload.length > 100) {
    throw new Error(`Too many commands: ${payload.length} exceeds Discord's limit of 100`);
  }
  const names = new Set<string>();
  for (const entry of payload) {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error('Command payload entry is not an object');
    }
    const { name, description } = entry as { name?: unknown; description?: unknown };
    if (typeof name !== 'string' || !COMMAND_NAME_PATTERN.test(name)) {
      throw new Error(`Invalid command name in payload: ${JSON.stringify(name)}`);
    }
    if (names.has(name)) {
      throw new Error(`Duplicate command name in payload: ${name}`);
    }
    names.add(name);
    if (typeof description !== 'string' || description.length < 1 || description.length > 100) {
      throw new Error(`Invalid description for command "${name}" (must be 1–100 characters)`);
    }
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  const registry = buildRegistry();
  const payload = registry.commandPayload();
  validatePayload(payload);

  if (options.dryRun) {
    console.log(JSON.stringify(payload, null, 2));
    console.log(`\n${payload.length} command(s) in payload (dry run — nothing sent)`);
    return;
  }

  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.CLIENT_ID;
  if (token === undefined || token === '') {
    throw new Error('DISCORD_TOKEN is not set (see .env.example)');
  }
  if (clientId === undefined || clientId === '') {
    throw new Error('CLIENT_ID is not set (see .env.example)');
  }

  const guildId = options.guildId ?? (options.global ? undefined : process.env.GUILD_ID);
  if (!options.global && (guildId === undefined || guildId === '')) {
    throw new Error('No target: pass --global, --guild <id>, or set GUILD_ID in .env');
  }

  const rest = new REST({ version: '10' }).setToken(token);
  const route =
    guildId !== undefined
      ? Routes.applicationGuildCommands(clientId, guildId)
      : Routes.applicationCommands(clientId);

  const result = await rest.put(route, { body: payload });
  const count = Array.isArray(result) ? result.length : payload.length;

  await writeFile(
    '.last-deploy.json',
    JSON.stringify(
      {
        deployedAt: new Date().toISOString(),
        scope: guildId !== undefined ? `guild:${guildId}` : 'global',
        payload,
      },
      null,
      2,
    ),
  );

  console.log(
    `Registered ${count} command(s) ${guildId !== undefined ? `to guild ${guildId}` : 'globally'}. ` +
      'Payload saved to .last-deploy.json',
  );
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error: unknown) => {
    console.error('Deploy failed:', error);
    process.exit(1);
  });
}

import 'dotenv/config';
import { Player } from 'discord-player';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { loadConfig } from './config/env.js';
import type { AppContext } from './core/context.js';
import { CooldownStore } from './core/cooldowns.js';
import { serializeError } from './core/errors.js';
import { createLogger } from './core/logger.js';
import { attachRouter } from './core/router.js';
import { ensureIndexes } from './db/indexes.js';
import { closeMongo, connectMongo } from './db/mongo.js';
import { buildRegistry } from './features/index.js';
import { attachAiMessageHandler } from './features/ai/messages.js';
import { attachMusicEvents } from './features/music/events.js';
import { setupMusicPlayer } from './features/music/player.js';

/**
 * Bootstrap (PLAN §11): env → logger → mongo → client → player → registry →
 * router → login. Core dependencies fail fast; optional features degrade.
 *
 * Intents: Guilds + GuildVoiceStates (music) + GuildMessages (needed to
 * receive mention events for the Phase 5 AI chat). The privileged
 * MessageContent intent is deliberately NOT requested — AI triggers are
 * /ask, @mentions, and replies to the bot, none of which need it.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const registry = buildRegistry();
  logger.info({ commands: registry.commands.size }, 'command registry loaded');

  const db = await connectMongo(config.mongoUri, logger);
  await ensureIndexes(db.db, logger);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessages,
    ],
  });

  // The cast bridges a discord.js dual-typings identity clash: discord.js
  // ships index.d.mts (import) and index.d.ts (require) declarations, and
  // discord-player's CJS typings resolve the other copy, so the two `Client`
  // declarations fail private-field identity despite being the same class.
  const player = new Player(client as unknown as ConstructorParameters<typeof Player>[0]);

  // Music bootstrap (Phase 4): register extractors once + player events.
  // Never throws — a dead extractor degrades music, not the whole boot.
  // Phase 6 (P2-13): the bootstrap result is surfaced in the boot log so
  // a silently-dead extractor is visible to the operator.
  const musicStatus = await setupMusicPlayer(player, config, logger);
  logger.info(
    {
      extractors: musicStatus.registered,
      failedExtractors: musicStatus.failed,
      youtube: musicStatus.youtubeRegistered,
    },
    'music player ready',
  );
  if (!musicStatus.youtubeRegistered) {
    logger.warn('YouTube extractor did not register — YouTube playback is unavailable');
  }
  attachMusicEvents(player, logger);

  const ctx: AppContext = {
    client,
    player,
    db,
    config,
    logger,
    registry,
    cooldowns: new CooldownStore(),
  };

  attachRouter(ctx);

  // AI chat (Phase 5): mention/reply message triggers. Attaches only
  // when an OpenAI key is configured; never blocks boot otherwise.
  attachAiMessageHandler(ctx);

  client.once(Events.ClientReady, (readyClient) => {
    logger.info({ user: readyClient.user.tag }, 'CutieBot is ready');
  });
  client.on(Events.Error, (error) => {
    logger.error({ err: serializeError(error) }, 'Discord client error');
  });

  registerShutdown(ctx);
  await client.login(config.discordToken);
}

let shuttingDown = false;

function registerShutdown(ctx: AppContext): void {
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    ctx.logger.info({ signal }, 'shutting down');

    // Hard-exit backstop: never hang on a stuck connection close.
    const hardExit = setTimeout(() => {
      ctx.logger.error('graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, 10_000);
    hardExit.unref();

    void (async () => {
      try {
        await ctx.player.destroy();
      } catch (error) {
        ctx.logger.error({ err: serializeError(error) }, 'error destroying player during shutdown');
      }
      try {
        await ctx.client.destroy();
      } catch (error) {
        ctx.logger.error({ err: serializeError(error) }, 'error destroying client during shutdown');
      }
      try {
        await closeMongo(ctx.db, ctx.logger);
      } catch (error) {
        ctx.logger.error({ err: serializeError(error) }, 'error closing MongoDB during shutdown');
      }
      clearTimeout(hardExit);
      process.exit(0);
    })();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  // Logger may not exist yet (env validation) — plain stderr is correct
  // here, but never the RAW exception (Phase 6c, R7): provider/Mongo
  // errors can embed credentials. serializeError's allowlist projection
  // + scrubber is the boundary; EnvError messages name variables only
  // (never values), so they survive the scrubber verbatim and the boot
  // failure stays diagnosable — name included, e.g. "EnvError: …".
  const safe = serializeError(error);
  console.error(`Fatal: CutieBot failed to start: ${safe.name}: ${safe.message}`);
  process.exit(1);
});

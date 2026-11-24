import { AttachmentExtractor } from '@discord-player/extractor';
import { Player } from 'discord-player';
import { Client, GatewayIntentBits } from 'discord.js';
import { loadConfig } from '../src/config/env.js';
import { createLogger } from '../src/core/logger.js';
import { attachMusicEvents } from '../src/features/music/events.js';
import {
  DEFAULT_EXTRACTOR_IDS,
  setupMusicPlayer,
  YOUTUBE_EXTRACTOR_ID,
} from '../src/features/music/player.js';

/**
 * Phase 4 smoke check (no Discord login, no token use): construct a real
 * discord.js Client + discord-player Player from the COMPILED output, run
 * the production music bootstrap, and assert the extractor registry looks
 * the way the plan requires:
 *  - every default extractor registered (SoundCloud/Vimeo/Reverbnation/
 *    AppleMusic/Spotify),
 *  - the AttachmentExtractor NOT registered (SSRF guard),
 *  - the YouTube extractor registered, or an explicit warning if its
 *    activation failed in this environment (it degrades, never blocks).
 *
 * Run after `npm run build`:  node dist/scripts/smoke-music.js
 * Exits non-zero when a hard assertion fails.
 */
async function main(): Promise<void> {
  const config = loadConfig({
    DISCORD_TOKEN: 'smoke-token-not-used',
    CLIENT_ID: '123456789012345678',
    MONGO_URI: 'mongodb://127.0.0.1:27017/smoke',
  });
  const logger = createLogger('silent');

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });
  // Same dual-typings cast as src/index.ts.
  const player = new Player(client as unknown as ConstructorParameters<typeof Player>[0]);

  const failures: string[] = [];
  try {
    const status = await setupMusicPlayer(player, config, logger);
    attachMusicEvents(player, logger);

    for (const id of DEFAULT_EXTRACTOR_IDS) {
      if (!status.registered.includes(id)) failures.push(`missing default extractor: ${id}`);
    }
    if (status.registered.includes(AttachmentExtractor.identifier)) {
      failures.push('AttachmentExtractor is registered but must not be (SSRF guard)');
    }

    console.log(`registered extractors (${status.registered.length}):`);
    for (const id of status.registered) console.log(`  - ${id}`);
    console.log(
      status.youtubeRegistered
        ? `youtube extractor: registered (${YOUTUBE_EXTRACTOR_ID})`
        : 'youtube extractor: NOT registered (activation failed in this environment — degraded, not fatal)',
    );
  } finally {
    await player.destroy().catch(() => undefined);
    await client.destroy().catch(() => undefined);
  }

  if (failures.length > 0) {
    console.error(`SMOKE FAILED:\n${failures.map((f) => `  - ${f}`).join('\n')}`);
    process.exit(1);
  }
  console.log('SMOKE OK: player constructed and extractors registered without a login.');
}

main().catch((error: unknown) => {
  console.error('SMOKE FAILED with exception:', error);
  process.exit(1);
});

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import type { ComponentModule } from '../../../core/contracts.js';
import { nowPlayingEmbed, queuePageEmbed, trackDisplayOf } from '../embeds.js';
import { MusicError } from '../guards.js';
import { checkAccessFresh } from '../helpers.js';
import { loopModeName, MAX_VOLUME, nextLoopMode, stepVolume, VOLUME_STEP } from '../logic.js';
import { confirmEphemeral, runMusicComponent } from './shared.js';

/**
 * Controller buttons (PLAN §7) — the v3 counterpart of the legacy
 * src/buttons/* set, attached to every now-playing message. Legacy custom
 * IDs were JSON blobs dispatched by dynamic require, and the buttons had
 * NO authorization checks (AUDIT §1.8/§6); v3 routes `music:<action>`
 * IDs through the router registry with the same voice-channel guard as
 * the slash commands. There is no requester/DJ restriction — legacy DJ
 * mode shipped disabled (see guards.ts).
 *
 * Phase 6 (P1-05/G5): the buttons are no longer static. Every row is
 * built for a queue SESSION — the custom IDs carry the queue's
 * immutable session token (`music:skip:<sessionId>`) — and
 * runMusicComponent refuses clicks whose token no longer matches the
 * live queue, so a stale now-playing message cannot control its
 * replacement. The volume row also gains the Now Playing button (the
 * `music:nowplaying` component existed but no button emitted it, G15)
 * and the Save button (legacy `savetrack`: DM yourself the track).
 */

/** Router arg spec for session-carrying components: exactly one token. */
const SESSION_ARGS = { count: 1, pattern: /^[0-9a-f]{12}$/ } as const;

export function controllerRow(sessionId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`music:back:${sessionId}`)
      .setLabel('Back')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`music:loop:${sessionId}`)
      .setLabel('Loop')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`music:pause:${sessionId}`)
      .setLabel('Resume & Pause')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`music:queue:${sessionId}`)
      .setLabel('Queue')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`music:skip:${sessionId}`)
      .setLabel('Skip')
      .setStyle(ButtonStyle.Primary),
  );
}

/** Second row used by /nowplaying (legacy had volume buttons there). */
export function volumeRow(sessionId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`music:volumedown:${sessionId}`)
      .setLabel('Volume Down')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`music:volumeup:${sessionId}`)
      .setLabel('Volume Up')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`music:nowplaying:${sessionId}`)
      .setLabel('Now Playing')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`music:save:${sessionId}`)
      .setLabel('Save Track')
      .setStyle(ButtonStyle.Secondary),
  );
}

export const backComponent: ComponentModule = {
  key: 'music:back',
  args: SESSION_ARGS,
  async execute(ctx, interaction, args) {
    await runMusicComponent(
      ctx,
      interaction,
      'active',
      async ({ queue }) => {
        if (queue === null) throw new MusicError('No music is currently playing.');
        if (queue.history.previousTrack === null) {
          throw new MusicError('There was no music played before.');
        }
        // Phase 6 (P2-10): ack BEFORE the slow history jump.
        if (!interaction.deferred && !interaction.replied) {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        }
        // Phase 6e (R5-C): re-authorize AFTER the defer, immediately
        // before the mutation. runMusicComponent's fresh check ran
        // before this body — the defer is a network round-trip during
        // which the clicker's voice state can change (the Phase 6c
        // check placement GPT's re-review rejected for this button).
        const access = await checkAccessFresh(ctx, interaction, 'active');
        if (!access.ok) throw new MusicError(access.error);
        await queue.history.back();
        await confirmEphemeral(interaction, 'Playing the **previous** track ✅');
      },
      args[0],
      // Phase 6c (R5): back is ASYNC (defer + history jump) — the
      // Phase 6 code checked the snapshot once, before the defer, with
      // no lock and no recheck. Now the whole flow runs inside the
      // per-guild lock with a forced-fetch freshness check.
      { fresh: true, locked: true },
    );
  },
};

export const loopComponent: ComponentModule = {
  key: 'music:loop',
  args: SESSION_ARGS,
  async execute(ctx, interaction, args) {
    await runMusicComponent(
      ctx,
      interaction,
      'active',
      async ({ queue }) => {
        if (queue === null) throw new MusicError('No music is currently playing.');
        const next = nextLoopMode(queue.repeatMode);
        queue.setRepeatMode(next);
        await confirmEphemeral(interaction, `Loop has been set to **${loopModeName(next)}** ✅`);
      },
      args[0],
    );
  },
};

export const pauseComponent: ComponentModule = {
  key: 'music:pause',
  args: SESSION_ARGS,
  async execute(ctx, interaction, args) {
    await runMusicComponent(
      ctx,
      interaction,
      'active',
      async ({ queue }) => {
        if (queue === null) throw new MusicError('No music is currently playing.');
        const title =
          queue.currentTrack !== null
            ? trackDisplayOf(queue.currentTrack).title
            : 'the current track';
        if (queue.node.isPaused()) {
          queue.node.resume();
          await confirmEphemeral(interaction, `Current music **${title}** resumed ✅`);
        } else {
          queue.node.pause();
          await confirmEphemeral(interaction, `Current music **${title}** paused ✅`);
        }
      },
      args[0],
    );
  },
};

export const skipComponent: ComponentModule = {
  key: 'music:skip',
  args: SESSION_ARGS,
  async execute(ctx, interaction, args) {
    await runMusicComponent(
      ctx,
      interaction,
      'active',
      async ({ queue }) => {
        if (queue === null) throw new MusicError('No music is currently playing.');
        const title =
          queue.currentTrack !== null
            ? trackDisplayOf(queue.currentTrack).title
            : 'the current track';
        if (!queue.node.skip()) throw new MusicError('Something went wrong while skipping.');
        await confirmEphemeral(interaction, `Current music **${title}** skipped ✅`);
      },
      args[0],
    );
  },
};

export const queueComponent: ComponentModule = {
  key: 'music:queue',
  args: SESSION_ARGS,
  async execute(ctx, interaction, args) {
    await runMusicComponent(
      ctx,
      interaction,
      'exists',
      async ({ queue }) => {
        if (queue === null) throw new MusicError('No music is currently playing.');
        const embed = queuePageEmbed({
          guildName: interaction.guild?.name ?? 'this server',
          current: queue.currentTrack !== null ? trackDisplayOf(queue.currentTrack) : null,
          upcoming: queue.tracks.toArray().map(trackDisplayOf),
          requestedPage: 1,
          repeatMode: queue.repeatMode,
        });
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      },
      args[0],
    );
  },
};

export const nowPlayingComponent: ComponentModule = {
  key: 'music:nowplaying',
  args: SESSION_ARGS,
  async execute(ctx, interaction, args) {
    await runMusicComponent(
      ctx,
      interaction,
      'active',
      async ({ queue }) => {
        if (queue === null || queue.currentTrack === null) {
          throw new MusicError('No music is currently playing.');
        }
        const embed = nowPlayingEmbed({
          track: trackDisplayOf(queue.currentTrack),
          voiceChannelName: queue.channel?.name ?? null,
          progressBar: queue.node.createProgressBar(),
          volume: queue.node.volume,
          repeatMode: queue.repeatMode,
          paused: queue.node.isPaused(),
        });
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      },
      args[0],
    );
  },
};

/**
 * Save-track button (legacy `savetrack`): DM the current track to the
 * clicker so they can find it later. Falls back to an ephemeral refusal
 * when DMs are closed.
 */
export const saveComponent: ComponentModule = {
  key: 'music:save',
  args: SESSION_ARGS,
  async execute(ctx, interaction, args) {
    await runMusicComponent(
      ctx,
      interaction,
      'active',
      async ({ queue }) => {
        if (queue === null || queue.currentTrack === null) {
          throw new MusicError('No music is currently playing.');
        }
        const track = queue.currentTrack;
        const display = trackDisplayOf(track);
        // Phase 6c (cheap P2): ack BEFORE the DM send — a slow or
        // hanging DM call must not eat the interaction's ack window.
        if (!interaction.deferred && !interaction.replied) {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        }
        try {
          await interaction.user.send(
            `🎵 Saved from **${interaction.guild?.name ?? 'a server'}**: **${display.title}**\n${display.url}`,
          );
        } catch {
          throw new MusicError(
            "I couldn't DM you that track — your DMs may be closed. The track is: " + display.url,
          );
        }
        await confirmEphemeral(interaction, 'Sent you that track in a DM ✅');
      },
      args[0],
    );
  },
};

function volumeComponent(key: string, delta: number): ComponentModule {
  return {
    key,
    args: SESSION_ARGS,
    async execute(ctx, interaction, args) {
      await runMusicComponent(
        ctx,
        interaction,
        'active',
        async ({ queue }) => {
          if (queue === null) throw new MusicError('No music is currently playing.');
          const verdict = stepVolume(queue.node.volume, delta);
          if (!verdict.ok) throw new MusicError(verdict.error);
          queue.node.setVolume(verdict.value);
          await confirmEphemeral(
            interaction,
            `The volume has been modified to **${verdict.value}**/**${MAX_VOLUME}**% 🔊`,
          );
        },
        args[0],
      );
    },
  };
}

export const volumeUpComponent: ComponentModule = volumeComponent('music:volumeup', VOLUME_STEP);
export const volumeDownComponent: ComponentModule = volumeComponent(
  'music:volumedown',
  -VOLUME_STEP,
);

export const controllerComponents: readonly ComponentModule[] = [
  backComponent,
  loopComponent,
  pauseComponent,
  queueComponent,
  skipComponent,
  nowPlayingComponent,
  saveComponent,
  volumeUpComponent,
  volumeDownComponent,
];

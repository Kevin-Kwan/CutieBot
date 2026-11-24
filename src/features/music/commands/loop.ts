import { QueueRepeatMode } from 'discord-player';
import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { MusicError } from '../guards.js';
import { loopModeName, loopTransition } from '../logic.js';
import { confirm, runMusicCommand } from './shared.js';

const ACTIONS = {
  track: QueueRepeatMode.TRACK,
  queue: QueueRepeatMode.QUEUE,
  off: QueueRepeatMode.OFF,
} as const;

/**
 * /loop — set the repeat mode. Legacy choices (Song / Queue / Disable)
 * with the legacy rule that track-loop and queue-loop cannot be switched
 * directly; the mode must be disabled first.
 */
export const loopCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('loop')
    .setDescription('enable or disable looping of songs or the whole queue')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option
        .setName('action')
        .setDescription('what action you want to perform on the loop')
        .setRequired(true)
        .addChoices(
          { name: 'Song', value: 'track' },
          { name: 'Queue', value: 'queue' },
          { name: 'Disable', value: 'off' },
        ),
    ),
  policy: { guildOnly: true },

  async execute(ctx, interaction) {
    await runMusicCommand(ctx, interaction, 'active', async ({ queue }) => {
      if (queue === null) throw new MusicError('No music is currently playing.');
      const action = interaction.options.getString('action', true) as keyof typeof ACTIONS;
      const target = ACTIONS[action];
      const verdict = loopTransition(queue.repeatMode, target);
      if (!verdict.ok) throw new MusicError(verdict.error);
      queue.setRepeatMode(target);
      if (target === QueueRepeatMode.OFF) {
        await confirm(interaction, 'Repeat mode **disabled** ✅');
      } else {
        await confirm(
          interaction,
          `Repeat mode **enabled** — the ${loopModeName(target) === 'track' ? 'current song' : 'whole queue'} will be repeated endlessly 🔁`,
        );
      }
    });
  },
};

import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { MusicError } from '../guards.js';
import { MAX_VOLUME, volumeVerdict } from '../logic.js';
import { confirm, runMusicCommand } from './shared.js';

/** /volume — set the playback volume (legacy bounds 1..100). */
export const volumeCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('volume')
    .setDescription('adjust the volume')
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((option) =>
      option
        .setName('volume')
        .setDescription('the amount of volume')
        .setMinValue(1)
        .setMaxValue(MAX_VOLUME)
        .setRequired(true),
    ),
  policy: { guildOnly: true },

  async execute(ctx, interaction) {
    await runMusicCommand(ctx, interaction, 'exists', async ({ queue }) => {
      if (queue === null) throw new MusicError('No music is currently playing.');
      const requested = interaction.options.getInteger('volume', true);
      const verdict = volumeVerdict(requested, queue.node.volume);
      if (!verdict.ok) throw new MusicError(verdict.error);
      if (!queue.node.setVolume(verdict.value)) {
        throw new MusicError('Something went wrong while changing the volume.');
      }
      await confirm(
        interaction,
        `The volume has been modified to **${verdict.value}**/**${MAX_VOLUME}**% 🔊`,
      );
    });
  },
};

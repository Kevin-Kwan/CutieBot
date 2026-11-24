import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { MusicError } from '../guards.js';
import { parseSeekTime } from '../logic.js';
import { confirm, runMusicCommand } from './shared.js';

/** Format milliseconds as m:ss (or h:mm:ss) for confirmations. */
export function formatClock(ms: number): string {
  const totalSeconds = Math.floor(ms / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const ss = String(seconds).padStart(2, '0');
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`;
  return `${minutes}:${ss}`;
}

/**
 * /seek — jump to a position in the current track. Legacy parsed the time
 * with the undeclared `ms` package (AUDIT §3) and carried a comment saying
 * seek was broken; v3 uses the tested parseSeekTime and the v7 seek API.
 */
export const seekCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('seek')
    .setDescription('skip back or forward in a song')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option
        .setName('time')
        .setDescription('time you want to skip to (e.g. 1:30, 90, 1m30s)')
        .setRequired(true),
    ),
  policy: { guildOnly: true },

  async execute(ctx, interaction) {
    await runMusicCommand(ctx, interaction, 'active', async ({ queue }) => {
      if (queue === null || queue.currentTrack === null) {
        throw new MusicError('No music is currently playing.');
      }
      const track = queue.currentTrack;
      const parsed = parseSeekTime(interaction.options.getString('time', true));
      if (!parsed.ok) throw new MusicError(parsed.error);
      if (!track.seekable) {
        throw new MusicError('This track cannot be seeked (it may be a live stream).');
      }
      if (parsed.value >= track.durationMS) {
        throw new MusicError(
          `The indicated time is higher than the total time of the current song (${track.duration}). ` +
            'Try a valid time like **1:30**.',
        );
      }
      const success = await queue.node.seek(parsed.value);
      if (!success) throw new MusicError('Seeking failed for this track.');
      await confirm(
        interaction,
        `Time set on the current song to **${formatClock(parsed.value)}** ✅`,
      );
    });
  },
};

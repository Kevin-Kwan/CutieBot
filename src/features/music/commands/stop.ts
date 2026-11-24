import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { MusicError } from '../guards.js';
import { checkAccessFresh } from '../helpers.js';
import { getQueue, withGuildQueueLock } from '../queue.js';
import { confirm, runMusicCommand } from './shared.js';

/**
 * /stop — stop playback and clear the queue. The bot stays connected
 * briefly (leaveOnStop idle timer) so a follow-up /play is cheap; /leave
 * disconnects immediately. (Legacy /stop deleted the whole queue, which
 * made stop and leave the same action; v3 has both commands, so they are
 * distinct — see PHASE4.md.)
 *
 * Phase 6c (R5): the clear/stop runs inside the per-guild queue lock
 * against the CURRENT queue, like /leave.
 */
export const stopCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('stop the music and clear the queue')
    .setContexts(InteractionContextType.Guild),
  policy: { guildOnly: true },

  async execute(ctx, interaction) {
    await runMusicCommand(ctx, interaction, 'exists', async () => {
      if (interaction.guildId === null) throw new MusicError('No music is currently playing.');
      const guildId = interaction.guildId;
      await withGuildQueueLock(guildId, async () => {
        const queue = getQueue(ctx.player, guildId);
        if (queue === null) throw new MusicError('No music is currently playing.');
        // Phase 6e (R5-C): fresh authorization inside the lock,
        // against the CURRENT queue, before the destructive clear —
        // the runMusicCommand snapshot check is only a pre-check (see
        // leave.ts).
        const access = await checkAccessFresh(ctx, interaction, 'exists');
        if (!access.ok) throw new MusicError(access.error);
        if (queue.currentTrack === null && queue.tracks.size === 0) {
          throw new MusicError('Nothing is playing right now.');
        }
        queue.clear();
        queue.node.stop();
        await confirm(interaction, 'Music stopped and the queue cleared, see you next time ✅');
      });
    });
  },
};

import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { MusicError } from '../guards.js';
import { checkAccessFresh } from '../helpers.js';
import { getQueue, withGuildQueueLock } from '../queue.js';
import { confirm, runMusicCommand } from './shared.js';

/**
 * /clear — clear the UPCOMING tracks, keeping the current track playing
 * (legacy slash /clear parity, restored in Phase 6: the legacy command
 * existed in the old tree's slash set but was dropped in the Phase 4
 * port; /stop remains the full stop-and-clear). Refuses when there is
 * nothing queued to clear.
 *
 * Phase 6c (R5): like /stop and /leave, the clear runs inside the
 * per-guild queue lock against the CURRENT queue.
 */
export const clearCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('clear the queue (keeps the current track playing)')
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
        if (queue.tracks.size === 0) {
          throw new MusicError('There are no upcoming tracks to clear.');
        }
        const cleared = queue.tracks.size;
        queue.clear();
        await confirm(interaction, `Cleared **${cleared}** track(s) from the queue ✅`);
      });
    });
  },
};

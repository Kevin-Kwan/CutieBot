import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { MusicError } from '../guards.js';
import { checkAccessFresh } from '../helpers.js';
import { getQueue, withGuildQueueLock } from '../queue.js';
import { confirm, runMusicCommand } from './shared.js';

/**
 * /leave — disconnect from the voice channel and destroy the queue now.
 *
 * Phase 6c (R5): the delete runs inside the per-guild queue lock
 * against the CURRENT queue, so a /leave racing a /play or a
 * search-select pick cannot delete a queue out from under an in-flight
 * insert (or be undone by one landing after it).
 *
 * Phase 6e (R5-C): authorization ALSO runs inside the lock, against
 * the CURRENT queue, immediately before the delete. The snapshot
 * check in runMusicCommand is only a pre-check: a user authorized
 * against queue A who waited for the lock must not delete a
 * replacement queue B they have no access to. Order: ack → lock →
 * resolve current queue → fresh authorization → mutation.
 */
export const leaveCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('leave')
    .setDescription('leave the voice channel and clear the queue')
    .setContexts(InteractionContextType.Guild),
  policy: { guildOnly: true },

  async execute(ctx, interaction) {
    await runMusicCommand(ctx, interaction, 'exists', async () => {
      if (interaction.guildId === null) throw new MusicError('No music is currently playing.');
      const guildId = interaction.guildId;
      await withGuildQueueLock(guildId, async () => {
        const queue = getQueue(ctx.player, guildId);
        if (queue === null) throw new MusicError('No music is currently playing.');
        const access = await checkAccessFresh(ctx, interaction, 'exists');
        if (!access.ok) throw new MusicError(access.error);
        const channelName = queue.channel?.name ?? null;
        queue.delete();
        await confirm(
          interaction,
          channelName !== null
            ? `Left **${channelName}** and cleared the queue ✅`
            : 'Left the voice channel and cleared the queue ✅',
        );
      });
    });
  },
};

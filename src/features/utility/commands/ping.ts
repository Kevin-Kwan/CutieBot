import { SlashCommandBuilder } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';

/**
 * /ping — the Phase 1 vertical slice: builder → registry → router → reply.
 * Reports the round-trip latency of the reply plus the gateway heartbeat.
 */
export const pingCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check that CutieBot is alive and see its latency'),

  async execute(ctx, interaction) {
    const startedAt = Date.now();
    await interaction.reply({ content: 'Pinging…' });
    const roundTripMs = Date.now() - startedAt;
    const heartbeatMs = Math.round(ctx.client.ws.ping);
    await interaction.editReply({
      content: `Pong! Round-trip: ${roundTripMs}ms · Gateway heartbeat: ${heartbeatMs}ms`,
    });
  },
};

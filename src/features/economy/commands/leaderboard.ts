import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { economyEmbed, formatMoney } from '../../../shared/embeds.js';
import { runEconomy } from './shared.js';

const MEDALS = ['🥇', '🥈', '🥉'] as const;

/**
 * /leaderboard — global top 10 by net worth (wallet + bank), the old
 * mainbank.js board, with a deterministic userId tie-break in the repo.
 * Names resolve from the client cache first, then a fetch; unresolvable
 * users are skipped, as in the old command.
 *
 * Phase 6 (P2-05/G11): bot accounts are EXCLUDED (PLAN §6) — the repo
 * over-fetches (25) and the board stops at 10 displayable humans, so
 * bots and unresolvable users cannot crowd real members off the board.
 */
const BOARD_SIZE = 10;
const OVERFETCH = 25;

export const leaderboardCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription("get the top members' net worth")
    .setContexts(InteractionContextType.Guild),
  policy: { guildOnly: true },

  async execute(ctx, interaction) {
    await runEconomy(ctx, interaction, async (service) => {
      const entries = await service.leaderboard(OVERFETCH);
      const lines: string[] = [];
      for (const entry of entries) {
        if (lines.length >= BOARD_SIZE) break;
        let user = ctx.client.users.cache.get(entry.userId);
        if (user === undefined) {
          try {
            user = await ctx.client.users.fetch(entry.userId);
          } catch {
            user = undefined;
          }
        }
        if (user === undefined || user.bot) continue;
        const tag = user.tag;
        const rank = lines.length + 1;
        const medal = MEDALS[rank - 1];
        const label = medal === undefined ? `${rank}` : medal;
        lines.push(`**${label} \`${tag}\` — ${formatMoney(entry.net)}**`);
      }

      const embed = economyEmbed(
        `Top ${lines.length} Richest Users - Leaderboard`,
        lines.length > 0
          ? `Based on Net Worth (wallet + bank) of Global Users\n\n${lines.join('\n')}`
          : 'No accounts yet — claim a /daily to get on the board.',
      )
        .setTimestamp()
        .setFooter({ text: `GLOBAL - ${interaction.guild?.name ?? 'this server'}` });
      await interaction.editReply({ embeds: [embed] });
    });
  },
};

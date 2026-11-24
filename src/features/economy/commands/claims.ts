import { SlashCommandBuilder, userMention, InteractionContextType } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { economyEmbed, formatDuration, formatMoney, successEmbed } from '../../../shared/embeds.js';
import type { RewardKind } from '../types.js';
import { runEconomy } from './shared.js';

/**
 * Factory for the timed-reward commands. Amounts/cooldowns live in
 * REWARDS (types.ts): daily randint(3000, 5000)/24 h, weekly
 * randint(7000, 10000)/7 d, monthly randint(30000, 50000)/30 d — the old
 * economy.js values, but with the cooldown persisted on the account
 * instead of an in-memory map that reset on restart.
 */
function makeClaimCommand(kind: RewardKind, name: string, description: string): CommandModule {
  return {
    data: new SlashCommandBuilder()
      .setName(name)
      .setDescription(description)
      .setContexts(InteractionContextType.Guild),
    policy: { guildOnly: true },

    async execute(ctx, interaction) {
      await runEconomy(ctx, interaction, async (service) => {
        const outcome = await service.claim(interaction.user.id, kind);
        if (outcome.status === 'cooldown') {
          const remaining = outcome.nextAvailableAt - Date.now();
          const embed = economyEmbed(
            name[0]?.toUpperCase() + name.slice(1),
            `You already claimed your ${name} pocket money. Come back in ${formatDuration(remaining)}.`,
          );
          await interaction.editReply({ embeds: [embed] });
          return;
        }
        const embed = successEmbed(
          name[0]?.toUpperCase() + name.slice(1),
          `${userMention(interaction.user.id)} your ${name} pocket money is ${formatMoney(outcome.amount)}`,
        ).addFields({ name: 'Wallet', value: formatMoney(outcome.user.wallet), inline: true });
        await interaction.editReply({ embeds: [embed] });
      });
    },
  };
}

export const dailyCommand = makeClaimCommand('daily', 'daily', 'get daily pocket money');
export const weeklyCommand = makeClaimCommand('weekly', 'weekly', 'get weekly pocket money');
export const monthlyCommand = makeClaimCommand('monthly', 'monthly', 'get monthly pocket money');

import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { economyEmbed, formatMoney } from '../../../shared/embeds.js';
import { runEconomy } from './shared.js';

/** /roulette — a straight 50/50 gamble; win +bet, lose −bet (old fun.js math). */
export const rouletteCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('roulette')
    .setDescription('just straight up gamble')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option.setName('amount').setDescription("enter amount, 'all' or 'max'").setRequired(true),
    ),
  policy: { guildOnly: true },

  async execute(ctx, interaction) {
    await runEconomy(ctx, interaction, async (service) => {
      const rawAmount = interaction.options.getString('amount', true);
      const { outcome, bet, user } = await service.playRoulette(
        interaction.user.id,
        rawAmount,
        interaction.id,
      );
      const embed = economyEmbed(
        'Roulette',
        outcome.won ? `You won ${formatMoney(bet)}!` : `You lost ${formatMoney(bet)}.`,
      ).addFields({ name: 'Wallet', value: formatMoney(user.wallet), inline: true });
      await interaction.editReply({ embeds: [embed] });
    });
  },
};

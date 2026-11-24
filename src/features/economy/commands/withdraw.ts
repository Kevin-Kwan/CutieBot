import { SlashCommandBuilder, userMention, InteractionContextType } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { formatMoney, successEmbed } from '../../../shared/embeds.js';
import { runEconomy } from './shared.js';

/** /withdraw — move bank money back into the wallet (atomic, see repo.moveFunds). */
export const withdrawCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('withdraw')
    .setDescription('withdraws money from bank')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option.setName('amount').setDescription("enter amount, 'all' or 'max'").setRequired(true),
    ),
  policy: { guildOnly: true },

  async execute(ctx, interaction) {
    await runEconomy(ctx, interaction, async (service) => {
      const rawAmount = interaction.options.getString('amount', true);
      const { amount, user } = await service.withdraw(
        interaction.user.id,
        rawAmount,
        interaction.id,
      );
      const embed = successEmbed(
        'Withdraw',
        `${userMention(interaction.user.id)} you withdrew ${formatMoney(amount)} to your wallet`,
      ).addFields(
        { name: 'Wallet', value: formatMoney(user.wallet), inline: true },
        { name: 'Bank', value: formatMoney(user.bank), inline: true },
      );
      await interaction.editReply({ embeds: [embed] });
    });
  },
};

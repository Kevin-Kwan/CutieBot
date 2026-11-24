import { SlashCommandBuilder, userMention, InteractionContextType } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { formatMoney, successEmbed } from '../../../shared/embeds.js';
import { runEconomy } from './shared.js';

/** /deposit — move wallet money into the bank (atomic, see repo.moveFunds). */
export const depositCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('deposit')
    .setDescription('deposit money into bank')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option.setName('amount').setDescription("enter amount, 'all' or 'max'").setRequired(true),
    ),
  policy: { guildOnly: true },

  async execute(ctx, interaction) {
    await runEconomy(ctx, interaction, async (service) => {
      const rawAmount = interaction.options.getString('amount', true);
      const { amount, user } = await service.deposit(
        interaction.user.id,
        rawAmount,
        interaction.id,
      );
      const embed = successEmbed(
        'Deposit',
        `${userMention(interaction.user.id)} you deposited ${formatMoney(amount)} in your bank`,
      ).addFields(
        { name: 'Wallet', value: formatMoney(user.wallet), inline: true },
        { name: 'Bank', value: formatMoney(user.bank), inline: true },
      );
      await interaction.editReply({ embeds: [embed] });
    });
  },
};

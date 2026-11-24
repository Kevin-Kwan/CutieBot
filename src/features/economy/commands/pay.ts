import { SlashCommandBuilder, userMention, InteractionContextType } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { formatMoney, successEmbed } from '../../../shared/embeds.js';
import { actorOf, runEconomy } from './shared.js';

/**
 * /pay — transfer wallet money to another member. Merges the old `pay`
 * (economy.js, button-confirmed) and `send` (mainbank.js, whose
 * insufficient-funds check compared a number to an array and never fired,
 * AUDIT §5.8). The v3 transfer is a single atomic transaction, so the old
 * 15-second confirm/cancel collector — which re-read nothing before
 * debiting — is gone; the payment executes immediately.
 */
export const payCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('pay')
    .setDescription('pay someone')
    .setContexts(InteractionContextType.Guild)
    .addUserOption((option) =>
      option.setName('member').setDescription('person to pay money to').setRequired(true),
    )
    .addStringOption((option) =>
      option.setName('amount').setDescription("amount, 'all' or 'max'").setRequired(true),
    ),
  policy: { guildOnly: true },

  async execute(ctx, interaction) {
    await runEconomy(ctx, interaction, async (service) => {
      const member = interaction.options.getUser('member', true);
      const rawAmount = interaction.options.getString('amount', true);
      const { amount, fromUser } = await service.pay(
        actorOf(interaction.user),
        actorOf(member),
        rawAmount,
        interaction.id,
      );
      const embed = successEmbed(
        'Payment Successful',
        `You paid ${userMention(member.id)} ${formatMoney(amount)}`,
      ).addFields({ name: 'Your Wallet', value: formatMoney(fromUser.wallet), inline: true });
      await interaction.editReply({ embeds: [embed] });
    });
  },
};

import { SlashCommandBuilder, userMention, InteractionContextType } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { formatMoney, successEmbed } from '../../../shared/embeds.js';
import { runEconomy } from './shared.js';

/** /buy — buy one item from the shop (debit + inventory credit are atomic). */
export const buyCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('buy')
    .setDescription('buy a item from shop')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option
        .setName('item_name')
        .setDescription('enter a item name from the shop')
        .setRequired(true),
    ),
  policy: { guildOnly: true },

  async execute(ctx, interaction) {
    await runEconomy(ctx, interaction, async (service) => {
      const query = interaction.options.getString('item_name', true);
      const { item, user } = await service.buy(interaction.user.id, query, interaction.id);
      const embed = successEmbed(
        'Purchase',
        `${userMention(interaction.user.id)} you bought ${item.name} for ${formatMoney(item.cost)}`,
      ).addFields({ name: 'Wallet', value: formatMoney(user.wallet), inline: true });
      await interaction.editReply({ embeds: [embed] });
    });
  },
};

import { SlashCommandBuilder, userMention, InteractionContextType } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { formatMoney, successEmbed } from '../../../shared/embeds.js';
import { runEconomy } from './shared.js';

/**
 * /sell — sell one owned item back at round(cost / 4). (The old command's
 * description was a copy-paste of /inventory's; fixed here.)
 */
export const sellCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('sell')
    .setDescription('sell a item from your inventory')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option
        .setName('item_name')
        .setDescription('sell a item from your inventory')
        .setRequired(true),
    ),
  policy: { guildOnly: true },

  async execute(ctx, interaction) {
    await runEconomy(ctx, interaction, async (service) => {
      const query = interaction.options.getString('item_name', true);
      const { item, price, user } = await service.sell(interaction.user.id, query, interaction.id);
      const embed = successEmbed(
        'Sale',
        `${userMention(interaction.user.id)} you sold ${item.name} for ${formatMoney(price)}`,
      ).addFields({ name: 'Wallet', value: formatMoney(user.wallet), inline: true });
      await interaction.editReply({ embeds: [embed] });
    });
  },
};

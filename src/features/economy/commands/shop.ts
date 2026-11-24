import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { economyEmbed, errorEmbed, formatMoney } from '../../../shared/embeds.js';
import { findItem, sellPrice } from '../shop.js';
import { runEconomy } from './shared.js';

/**
 * /shop — list the catalog, or show one item with its buy/sell prices
 * (sell = round(cost / 4), as in the old shop.js). The old command silently
 * never replied for an unknown item name; v3 answers with an error.
 */
export const shopCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('get the shop items')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option.setName('item_name').setDescription('get the item information').setRequired(false),
    ),
  policy: { guildOnly: true },

  async execute(ctx, interaction) {
    await runEconomy(ctx, interaction, async (service) => {
      const info = interaction.options.getString('item_name', false);
      if (info !== null) {
        const item = findItem(info);
        if (item === undefined) {
          await interaction.editReply({
            embeds: [errorEmbed(`There's no item named \`${info.trim().toLowerCase()}\`.`)],
          });
          return;
        }
        const embed = economyEmbed(item.name.toUpperCase(), item.info, [
          { name: 'Buying price', value: formatMoney(item.cost) },
          { name: 'Selling price', value: formatMoney(sellPrice(item)) },
        ]);
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      const embed = economyEmbed('SHOP', 'Items will appear here');
      for (const item of service.shopCatalog()) {
        embed.addFields({
          name: `${item.name.toUpperCase()} — ${formatMoney(item.cost)}`,
          value: `${item.info}\nID: \`${item.id}\``,
          inline: false,
        });
      }
      await interaction.editReply({ embeds: [embed] });
    });
  },
};

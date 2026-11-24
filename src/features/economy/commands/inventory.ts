import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { economyEmbed } from '../../../shared/embeds.js';
import { itemById } from '../shop.js';
import { actorOf, runEconomy } from './shared.js';

/** /inventory — the items a member owns (qty ≥ 1), with catalog names/ids. */
export const inventoryCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('get your item list')
    .setContexts(InteractionContextType.Guild)
    .addUserOption((option) =>
      option.setName('member').setDescription('target @member').setRequired(false),
    ),
  policy: { guildOnly: true },

  async execute(ctx, interaction) {
    await runEconomy(ctx, interaction, async (service) => {
      const target = interaction.options.getUser('member', false) ?? interaction.user;
      const account = await service.inventoryOf(actorOf(target));
      const owned = account.inventory.filter((entry) => entry.qty >= 1);
      const embed = economyEmbed(
        undefined,
        owned.length === 0 ? 'The items which you bought display here...' : undefined,
        owned.map((entry) => {
          const item = itemById(entry.itemId);
          const name = item?.name ?? `item #${entry.itemId}`;
          return { name: `${name.toUpperCase()} - ${entry.qty}`, value: `ID: ${entry.itemId}` };
        }),
      );
      embed.setAuthor({
        name: `${target.username}'s Inventory`,
        iconURL: target.displayAvatarURL(),
      });
      await interaction.editReply({ embeds: [embed] });
    });
  },
};

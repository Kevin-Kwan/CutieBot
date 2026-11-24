import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { economyEmbed, formatMoney, netWorth } from '../../../shared/embeds.js';
import { actorOf, runEconomy } from './shared.js';

/** /bank — your own wallet and bank balances at a glance. */
export const bankCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('bank')
    .setDescription('view your wallet and bank balances')
    .setContexts(InteractionContextType.Guild),
  policy: { guildOnly: true },

  async execute(ctx, interaction) {
    await runEconomy(ctx, interaction, async (service) => {
      const account = await service.balanceOf(actorOf(interaction.user));
      const embed = economyEmbed('Your Bank', undefined, [
        { name: 'Wallet', value: formatMoney(account.wallet), inline: true },
        { name: 'Bank', value: formatMoney(account.bank), inline: true },
        { name: 'Net Worth', value: formatMoney(netWorth(account)), inline: true },
      ]).setAuthor({
        name: interaction.user.username,
        iconURL: interaction.user.displayAvatarURL(),
      });
      await interaction.editReply({ embeds: [embed] });
    });
  },
};

import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { economyEmbed, formatMoney, netWorth } from '../../../shared/embeds.js';
import { actorOf, runEconomy } from './shared.js';

/** /balance — wallet, bank, and net worth for yourself or another member. */
export const balanceCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('get bank balance')
    .setContexts(InteractionContextType.Guild)
    .addUserOption((option) =>
      option.setName('member').setDescription('target @member').setRequired(false),
    ),
  policy: { guildOnly: true },

  async execute(ctx, interaction) {
    await runEconomy(ctx, interaction, async (service) => {
      const target = interaction.options.getUser('member', false) ?? interaction.user;
      const account = await service.balanceOf(actorOf(target));
      const embed = economyEmbed(
        'Balance',
        [
          `Wallet: ${formatMoney(account.wallet)}`,
          `Bank: ${formatMoney(account.bank)}`,
          `Net: ${formatMoney(netWorth(account))}`,
        ].join('\n'),
      ).setAuthor({ name: target.username, iconURL: target.displayAvatarURL() });
      await interaction.editReply({ embeds: [embed] });
    });
  },
};

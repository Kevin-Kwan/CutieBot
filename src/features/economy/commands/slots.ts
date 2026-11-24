import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { economyEmbed, formatMoney } from '../../../shared/embeds.js';
import { runEconomy } from './shared.js';

/**
 * /slots — three reels over the old 7 symbols. Jackpot +bet, any pair
 * +floor(bet/2), otherwise −bet. The grid display (payline marked 📍) is
 * the old fun.js presentation.
 */
export const slotsCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('slots')
    .setDescription('spin the slots and get MONEY')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option.setName('amount').setDescription("enter amount, 'all' or 'max'").setRequired(true),
    ),
  policy: { guildOnly: true },

  async execute(ctx, interaction) {
    await runEconomy(ctx, interaction, async (service) => {
      const rawAmount = interaction.options.getString('amount', true);
      const { outcome, bet, user } = await service.playSlots(
        interaction.user.id,
        rawAmount,
        interaction.id,
      );
      const sep = ' | ';
      const [above, , below] = outcome.displayRows;
      const grid = [
        '```',
        `| ${above?.join(sep) ?? ''} |`,
        `| ${outcome.payline.join(sep)} | 📍`,
        `| ${below?.join(sep) ?? ''} |`,
        '```',
      ].join('\n');
      const message =
        outcome.kind === 'jackpot'
          ? `Jackpot! you won ${formatMoney(bet)}`
          : outcome.kind === 'pair'
            ? `GG! you won ${formatMoney(Math.floor(bet / 2))}`
            : `You lost ${formatMoney(bet)}`;
      const embed = economyEmbed('Slots', `${grid}\n${message}`).addFields({
        name: 'Wallet',
        value: formatMoney(user.wallet),
        inline: true,
      });
      await interaction.editReply({ embeds: [embed] });
    });
  },
};

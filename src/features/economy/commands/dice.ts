import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { economyEmbed, formatMoney } from '../../../shared/embeds.js';
import { runEconomy } from './shared.js';

/**
 * /dice — bet on a die roll (default 6, the old default). Win +bet on an
 * exact match, lose −bet otherwise. The old roll could land on `undefined`
 * ~1/7 of the time (AUDIT §5.22); the v3 roll is a clean uniform 1–6.
 */
export const diceCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('dice')
    .setDescription('bet on number drawn from a rolling dice')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option.setName('amount').setDescription("enter amount, 'all' or 'max'").setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName('bet_on')
        .setDescription('enter a number of dice, default: 6')
        .setMinValue(1)
        .setMaxValue(6)
        .setRequired(false),
    ),
  policy: { guildOnly: true },

  async execute(ctx, interaction) {
    await runEconomy(ctx, interaction, async (service) => {
      const rawAmount = interaction.options.getString('amount', true);
      const betOn = interaction.options.getInteger('bet_on', false) ?? 6;
      const { outcome, bet, user } = await service.playDice(
        interaction.user.id,
        rawAmount,
        betOn,
        interaction.id,
      );
      const embed = economyEmbed(
        'Dice',
        outcome.won
          ? `Got ${outcome.roll}, you won ${formatMoney(bet)}!`
          : `Got ${outcome.roll}, you lost ${formatMoney(bet)}.`,
      ).addFields({ name: 'Wallet', value: formatMoney(user.wallet), inline: true });
      await interaction.editReply({ embeds: [embed] });
    });
  },
};

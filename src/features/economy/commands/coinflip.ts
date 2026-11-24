import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { economyEmbed, formatMoney } from '../../../shared/embeds.js';
import type { CoinSide } from '../games.js';
import { runEconomy } from './shared.js';

/** /coinflip — bet on heads or tails; win +bet, lose −bet (old fun.js math). */
export const coinflipCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('coinflip')
    .setDescription('bet on tossing a coin')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option
        .setName('bet_on')
        .setDescription('select either heads or tails')
        .addChoices({ name: 'heads', value: 'heads' }, { name: 'tails', value: 'tails' })
        .setRequired(true),
    )
    .addStringOption((option) =>
      option.setName('amount').setDescription("enter amount, 'all' or 'max'").setRequired(true),
    ),
  policy: { guildOnly: true },

  async execute(ctx, interaction) {
    await runEconomy(ctx, interaction, async (service) => {
      const choice = interaction.options.getString('bet_on', true) as CoinSide;
      const rawAmount = interaction.options.getString('amount', true);
      const { outcome, bet, user } = await service.playCoinflip(
        interaction.user.id,
        rawAmount,
        choice,
        interaction.id,
      );
      const embed = economyEmbed(
        'Coinflip',
        outcome.won
          ? `Got ${outcome.result}, you won ${formatMoney(bet)}!`
          : `Got ${outcome.result}, you lost ${formatMoney(bet)}.`,
      ).addFields({ name: 'Wallet', value: formatMoney(user.wallet), inline: true });
      await interaction.editReply({ embeds: [embed] });
    });
  },
};

import { SlashCommandBuilder, userMention, InteractionContextType } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { formatMoney, successEmbed } from '../../../shared/embeds.js';
import { actorOf, runEconomy } from './shared.js';

/**
 * /removemoney — owner-only removal. The old remove-money debited with a
 * bare $inc and could drive the target negative; v3 refuses amounts above
 * the wallet (service) and logs every use.
 */
export const removemoneyCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('removemoney')
    .setDescription('remove money from a member')
    .setContexts(InteractionContextType.Guild)
    .addUserOption((option) =>
      option.setName('member').setDescription('target @member').setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName('amount')
        .setDescription('enter a positive integer to remove')
        .setMinValue(1)
        .setRequired(true),
    ),
  policy: { guildOnly: true, ownerOnly: true },

  async execute(ctx, interaction) {
    await runEconomy(ctx, interaction, async (service) => {
      const member = interaction.options.getUser('member', true);
      const amount = interaction.options.getInteger('amount', true);
      const user = await service.adminRemove(actorOf(member), amount, interaction.id, interaction.user.id);
      ctx.logger.info(
        { action: 'removemoney', by: interaction.user.id, to: member.id, amount },
        'economy admin: money removed',
      );
      const embed = successEmbed(
        'Money Removed',
        `Removed ${formatMoney(amount)} from ${userMention(member.id)}`,
      ).addFields({ name: 'Their Wallet', value: formatMoney(user.wallet), inline: true });
      await interaction.editReply({ embeds: [embed] });
    });
  },
};

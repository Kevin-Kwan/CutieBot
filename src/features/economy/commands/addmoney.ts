import { SlashCommandBuilder, userMention, InteractionContextType } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { formatMoney, successEmbed } from '../../../shared/embeds.js';
import { actorOf, runEconomy } from './shared.js';

/**
 * /addmoney — owner-only mint. The old add-money relied solely on
 * setDefaultMemberPermissions(ManageGuild) with no audit trail (AUDIT
 * §6); v3 restricts it to the configured OWNER_ID (router policy) and
 * logs every use.
 */
export const addmoneyCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('addmoney')
    .setDescription('add money to a member')
    .setContexts(InteractionContextType.Guild)
    .addUserOption((option) =>
      option.setName('member').setDescription('target @member').setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName('amount')
        .setDescription('enter a positive integer')
        .setMinValue(1)
        .setRequired(true),
    ),
  policy: { guildOnly: true, ownerOnly: true },

  async execute(ctx, interaction) {
    await runEconomy(ctx, interaction, async (service) => {
      const member = interaction.options.getUser('member', true);
      const amount = interaction.options.getInteger('amount', true);
      const user = await service.adminAdd(actorOf(member), amount, interaction.id, interaction.user.id);
      ctx.logger.info(
        { action: 'addmoney', by: interaction.user.id, to: member.id, amount },
        'economy admin: money added',
      );
      const embed = successEmbed(
        'Money Added',
        `Added ${formatMoney(amount)} to ${userMention(member.id)}`,
      ).addFields({ name: 'Their Wallet', value: formatMoney(user.wallet), inline: true });
      await interaction.editReply({ embeds: [embed] });
    });
  },
};

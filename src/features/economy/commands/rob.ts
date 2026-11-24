import { SlashCommandBuilder, InteractionContextType } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { economyEmbed, errorEmbed, formatDuration, formatMoney } from '../../../shared/embeds.js';
import { RobCooldownError } from '../economy.service.js';
import { actorOf, runEconomy } from './shared.js';

/**
 * /rob — attempt to steal from another member. Bands (old fun.js comments):
 * 45% steal a random portion, 25% steal nothing, 25% get caught and pay a
 * $1000 fine, 5% steal the full amount. Cooldown 300 s, persisted on the
 * robber's account (the old in-memory cooldown reset on restart).
 */
export const robCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('rob')
    .setDescription('attempt to steal from another person')
    .setContexts(InteractionContextType.Guild)
    .addUserOption((option) =>
      option.setName('target').setDescription('select a user to steal from').setRequired(true),
    )
    .addStringOption((option) =>
      option.setName('amount').setDescription("enter amount, 'all' or 'max'").setRequired(true),
    ),
  policy: { guildOnly: true },

  async execute(ctx, interaction) {
    await runEconomy(ctx, interaction, async (service) => {
      const target = interaction.options.getUser('target', true);
      const rawAmount = interaction.options.getString('amount', true);
      try {
        const { outcome, fineApplied } = await service.robUser(
          actorOf(interaction.user),
          actorOf(target),
          rawAmount,
          interaction.id,
        );
        let description: string;
        if (outcome.stolen > 0) {
          description = `You managed to steal ${formatMoney(outcome.stolen)} from ${target.username}`;
        } else if (outcome.kind === 'caught') {
          description =
            `You failed to steal from ${target.username}! The police caught you ` +
            `and you had to pay ${formatMoney(fineApplied)} for bail.`;
        } else {
          description = `You failed to steal from ${target.username}.`;
        }
        await interaction.editReply({ embeds: [economyEmbed('Rob', description)] });
      } catch (error) {
        if (error instanceof RobCooldownError) {
          const remaining = error.nextAvailableAt - Date.now();
          await interaction.editReply({
            embeds: [
              errorEmbed(
                `You need to wait before robbing again. Try again in ${formatDuration(remaining)}.`,
              ),
            ],
          });
          return;
        }
        throw error;
      }
    });
  },
};

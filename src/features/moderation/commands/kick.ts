import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { successEmbed } from '../../../shared/embeds.js';
import {
  confirmSuccess,
  fetchTargetMember,
  guardModeration,
  logAction,
  logDenied,
  logRouterDenial,
  replyError,
  runModeration,
} from '../helpers.js';

/** /kick — KickMembers, hierarchy-checked; the target must be a member. */
export const kickCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member from this server.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption((option) =>
      option.setName('user').setDescription('The member to kick.').setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('The reason for the kick.')
        .setMaxLength(512)
        .setRequired(false),
    ),

  policy: {
    guildOnly: true,
    permissions: [PermissionFlagsBits.KickMembers],
    onPolicyDenied: (ctx, interaction, reason) => {
      logRouterDenial(ctx, 'kick', interaction, reason);
    },
  },

  async execute(ctx, interaction): Promise<void> {
    await runModeration(ctx, interaction, 'kick', async () => {
      const guild = interaction.guild;
      if (guild === null) {
        await replyError(ctx, interaction, 'This command can only be used in a server.');
        return;
      }

      const target = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason') ?? undefined;

      const targetMember = await fetchTargetMember(guild, target.id);
      if (targetMember === null) {
        logDenied(ctx, 'kick', interaction, target.id, reason, 'not-a-member');
        await replyError(ctx, interaction, 'That user is not a member of this server.');
        return;
      }

      const allowed = await guardModeration(
        ctx,
        interaction,
        targetMember,
        PermissionFlagsBits.KickMembers,
        'Kick Members',
      );
      if (!allowed) {
        logDenied(ctx, 'kick', interaction, target.id, reason, 'guard');
        return;
      }

      await targetMember.kick(reason);

      logAction(ctx, 'kick', interaction, target, reason);

      const description = [
        `<@${target.id}> (\`${target.id}\`) has been kicked.`,
        `**Reason:** ${reason ?? 'No reason provided.'}`,
      ].join('\n');

      await confirmSuccess(ctx, interaction, successEmbed('Member kicked', description));
    });
  },
};

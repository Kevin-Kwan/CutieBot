import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { successEmbed } from '../../../shared/embeds.js';
import { hasPermissions } from '../../../core/permissions.js';
import {
  confirmSuccess,
  fetchTargetMember,
  guardBotPermission,
  guardModeration,
  logAction,
  logDenied,
  logRouterDenial,
  replyError,
  runModeration,
} from '../helpers.js';

const SECONDS_PER_DAY = 24 * 60 * 60;

/** /ban — BanMembers, hierarchy-checked for members; non-members can be
 * banned by ID after the bot-permission check (no hierarchy exists for them). */
export const banCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a user from this server.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((option) =>
      option.setName('user').setDescription('The user to ban.').setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('The reason for the ban.')
        .setMaxLength(512)
        .setRequired(false),
    )
    .addIntegerOption((option) =>
      option
        .setName('delete_messages')
        .setDescription('Days of message history to delete (0–7).')
        .setMinValue(0)
        .setMaxValue(7)
        .setRequired(false),
    ),

  policy: {
    guildOnly: true,
    permissions: [PermissionFlagsBits.BanMembers],
    // Phase 6 (P2-07): router-level refusals join the feature audit log.
    onPolicyDenied: (ctx, interaction, reason) => {
      logRouterDenial(ctx, 'ban', interaction, reason);
    },
  },

  async execute(ctx, interaction): Promise<void> {
    await runModeration(ctx, interaction, 'ban', async () => {
      const guild = interaction.guild;
      if (guild === null) {
        await replyError(ctx, interaction, 'This command can only be used in a server.');
        return;
      }

      const target = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason') ?? undefined;
      const deleteDays = interaction.options.getInteger('delete_messages') ?? 0;

      if (!Number.isInteger(deleteDays) || deleteDays < 0 || deleteDays > 7) {
        logDenied(ctx, 'ban', interaction, target.id, reason, 'invalid-delete-days');
        await replyError(ctx, interaction, 'Message deletion must be between 0 and 7 days.');
        return;
      }

      const targetMember = await fetchTargetMember(guild, target.id);

      const banOptions = {
        deleteMessageSeconds: deleteDays * SECONDS_PER_DAY,
        ...(reason !== undefined ? { reason } : {}),
      };

      if (targetMember !== null) {
        const allowed = await guardModeration(
          ctx,
          interaction,
          targetMember,
          PermissionFlagsBits.BanMembers,
          'Ban Members',
        );
        if (!allowed) {
          logDenied(ctx, 'ban', interaction, target.id, reason, 'guard');
          return;
        }

        await guild.members.ban(targetMember.id, banOptions);
      } else {
        // Discord supports banning users who are not currently members of
        // the guild. Allow this after verifying the bot's permission; the
        // router enforces the invoker's Ban Members policy. No target role
        // hierarchy exists in this case. fetchTargetMember returns null ONLY
        // for Unknown Member, never for arbitrary API or network failures.
        const allowed = await guardBotPermission(
          ctx,
          interaction,
          PermissionFlagsBits.BanMembers,
          'Ban Members',
        );
        if (!allowed) {
          logDenied(ctx, 'ban', interaction, target.id, reason, 'guard');
          return;
        }

        // Phase 6 (P2-06): the invoker's permission for THIS path rests
        // on the router's check, which ran on a snapshot taken before
        // the member fetch above. Recheck the invoker's membership
        // FRESH immediately before creating the ban, so a permission
        // revoked mid-flight does not still land. Residual race: a
        // revocation landing between this fetch and bans.create cannot
        // be closed from the client side — Discord re-validates the
        // bot's own permission server-side, and the invoker window is
        // milliseconds; accepted and documented in PHASE6.md.
        // (Bot-as-target policy, orchestrator ruling: the bot target
        // protected by canModerate is CutieBot itself.)
        const invokerFresh = await guild.members.fetch({
          user: interaction.user.id,
          force: true,
        });
        if (!hasPermissions(invokerFresh.permissions, [PermissionFlagsBits.BanMembers])) {
          logDenied(ctx, 'ban', interaction, target.id, reason, 'invoker-permission-revoked');
          await replyError(
            ctx,
            interaction,
            'You need the Ban Members permission to perform this action.',
          );
          return;
        }

        await guild.bans.create(target.id, banOptions);
      }

      logAction(ctx, 'ban', interaction, target, reason);

      const description = [
        `<@${target.id}> (\`${target.id}\`) has been banned.`,
        `**Reason:** ${reason ?? 'No reason provided.'}`,
        `**Message history deleted:** ${deleteDays} day(s)`,
      ].join('\n');

      await confirmSuccess(ctx, interaction, successEmbed('User banned', description));
    });
  },
};

import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { MAX_TIMEOUT_MS, parseDuration } from '../../../shared/duration.js';
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

/** /timeout — ModerateMembers; apply with a parsed duration (max 28 days)
 * or remove an active timeout. Administrators can never be timed out. */
export const timeoutCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Timeout a member for a duration, or remove their timeout.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) =>
      option.setName('user').setDescription('The member to timeout.').setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('duration')
        .setDescription('Duration, e.g. 10m, 2h, 1d12h (max 28 days). Omit when removing.')
        .setMaxLength(64)
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('The reason for applying or removing the timeout.')
        .setMaxLength(512)
        .setRequired(false),
    )
    .addBooleanOption((option) =>
      option
        .setName('remove')
        .setDescription('Remove the existing timeout instead of applying one.')
        .setRequired(false),
    ),

  policy: {
    guildOnly: true,
    permissions: [PermissionFlagsBits.ModerateMembers],
    onPolicyDenied: (ctx, interaction, reason) => {
      logRouterDenial(ctx, 'timeout', interaction, reason);
    },
  },

  async execute(ctx, interaction): Promise<void> {
    await runModeration(ctx, interaction, 'timeout', async () => {
      const guild = interaction.guild;
      if (guild === null) {
        await replyError(ctx, interaction, 'This command can only be used in a server.');
        return;
      }

      const target = interaction.options.getUser('user', true);
      const duration = interaction.options.getString('duration');
      const remove = interaction.options.getBoolean('remove') ?? false;
      const reason = interaction.options.getString('reason') ?? undefined;

      let durationMs: number | null = null;

      // Phase 6 (P2-07): every refusal path writes an audit record —
      // these validation paths used to return with no trace at all.
      if (remove) {
        if (duration !== null) {
          logDenied(ctx, 'timeout.remove', interaction, target.id, reason, 'contradictory-options');
          await replyError(ctx, interaction, 'Do not specify a duration when remove is true.');
          return;
        }
      } else {
        if (duration === null) {
          logDenied(ctx, 'timeout.apply', interaction, target.id, reason, 'missing-duration');
          await replyError(
            ctx,
            interaction,
            'Provide a duration such as 10m or 2h, or set remove to true to remove a timeout.',
          );
          return;
        }

        const parsed = parseDuration(duration, MAX_TIMEOUT_MS);
        if (!parsed.ok) {
          logDenied(ctx, 'timeout.apply', interaction, target.id, reason, 'invalid-duration');
          await replyError(ctx, interaction, parsed.error);
          return;
        }

        durationMs = parsed.ms;
      }

      const targetMember = await fetchTargetMember(guild, target.id);
      if (targetMember === null) {
        logDenied(
          ctx,
          remove ? 'timeout.remove' : 'timeout.apply',
          interaction,
          target.id,
          reason,
          'not-a-member',
        );
        await replyError(ctx, interaction, 'That user is not a member of this server.');
        return;
      }

      const allowed = await guardModeration(
        ctx,
        interaction,
        targetMember,
        PermissionFlagsBits.ModerateMembers,
        'Moderate Members',
      );
      if (!allowed) {
        logDenied(
          ctx,
          remove ? 'timeout.remove' : 'timeout.apply',
          interaction,
          target.id,
          reason,
          'guard',
        );
        return;
      }

      // Discord does not allow applying timeouts to members with the
      // Administrator permission, even when their role hierarchy is lower.
      // This restriction is specific to timeout operations.
      if (!remove && targetMember.permissions.has(PermissionFlagsBits.Administrator)) {
        logDenied(ctx, 'timeout.apply', interaction, target.id, reason, 'administrator-target');
        await replyError(
          ctx,
          interaction,
          'Members with the Administrator permission cannot be timed out.',
        );
        return;
      }

      if (remove) {
        if (!targetMember.isCommunicationDisabled()) {
          logDenied(ctx, 'timeout.remove', interaction, target.id, reason, 'no-active-timeout');
          await replyError(
            ctx,
            interaction,
            'That member does not currently have an active timeout.',
          );
          return;
        }

        await targetMember.timeout(null, reason);

        logAction(ctx, 'timeout.remove', interaction, target, reason);

        const description = [
          `The timeout for <@${target.id}> (\`${target.id}\`) has been removed.`,
          `**Reason:** ${reason ?? 'No reason provided.'}`,
        ].join('\n');

        await confirmSuccess(ctx, interaction, successEmbed('Timeout removed', description));
        return;
      }

      // A successful duration parse is required for the apply branch.
      // Retain this explicit guard to satisfy strict null checking.
      if (durationMs === null) {
        await replyError(ctx, interaction, 'A valid timeout duration is required.');
        return;
      }

      const updatedMember = await targetMember.timeout(durationMs, reason);

      logAction(ctx, 'timeout.apply', interaction, target, reason);

      // Prefer Discord's returned expiration timestamp over a
      // locally calculated value.
      const expiresAt =
        updatedMember.communicationDisabledUntilTimestamp ?? Date.now() + durationMs;
      const expiresAtSeconds = Math.floor(expiresAt / 1_000);

      const description = [
        `<@${target.id}> (\`${target.id}\`) has been timed out.`,
        `**Duration:** ${duration?.trim() ?? `${durationMs}ms`}`,
        `**Expires:** <t:${expiresAtSeconds}:F>`,
        `**Time remaining:** <t:${expiresAtSeconds}:R>`,
        `**Reason:** ${reason ?? 'No reason provided.'}`,
      ].join('\n');

      await confirmSuccess(ctx, interaction, successEmbed('Member timed out', description));
    });
  },
};

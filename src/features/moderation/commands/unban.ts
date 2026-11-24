import {
  InteractionContextType,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
  SlashCommandBuilder,
} from 'discord.js';
import type { CommandModule } from '../../../core/contracts.js';
import { successEmbed } from '../../../shared/embeds.js';
import {
  guardBotPermission,
  isDiscordError,
  logAction,
  logDenied,
  logRouterDenial,
  replyError,
  confirmSuccess,
  runModeration,
} from '../helpers.js';

const MAX_SNOWFLAKE = (1n << 64n) - 1n;

function isValidSnowflake(value: string): boolean {
  // Discord snowflakes are unsigned 64-bit integer IDs.
  // Reject signs, decimals, whitespace, leading zeroes, and
  // excessively long strings before attempting BigInt conversion.
  if (!/^[1-9]\d{0,19}$/.test(value)) {
    return false;
  }
  return BigInt(value) <= MAX_SNOWFLAKE;
}

/**
 * /unban — removes a ban by user ID via guild.bans.remove. It must NEVER
 * ban: the legacy bot's unban was a copy of ban.js and banned the target
 * instead (AUDIT §5). A regression test pins this.
 */
export const unbanCommand: CommandModule = {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Remove a user ban from this server.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption((option) =>
      option
        .setName('user_id')
        .setDescription('The Discord user ID of the banned user.')
        .setMaxLength(20)
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('The reason for removing the ban.')
        .setMaxLength(512)
        .setRequired(false),
    ),

  policy: {
    guildOnly: true,
    permissions: [PermissionFlagsBits.BanMembers],
    onPolicyDenied: (ctx, interaction, reason) => {
      logRouterDenial(ctx, 'unban', interaction, reason);
    },
  },

  async execute(ctx, interaction): Promise<void> {
    await runModeration(ctx, interaction, 'unban', async () => {
      const guild = interaction.guild;
      if (guild === null) {
        await replyError(ctx, interaction, 'This command can only be used in a server.');
        return;
      }

      const userId = interaction.options.getString('user_id', true).trim();
      const reason = interaction.options.getString('reason') ?? undefined;

      if (!isValidSnowflake(userId)) {
        logDenied(ctx, 'unban', interaction, userId, reason, 'invalid-user-id');
        await replyError(ctx, interaction, 'Please provide a valid Discord user ID.');
        return;
      }

      const allowed = await guardBotPermission(
        ctx,
        interaction,
        PermissionFlagsBits.BanMembers,
        'Ban Members',
      );
      if (!allowed) {
        logDenied(ctx, 'unban', interaction, userId, reason, 'guard');
        return;
      }

      // Banned users are not guild members, so member hierarchy checks do
      // not apply. The router enforces the invoker's Ban Members permission
      // through command policy.
      try {
        await guild.bans.remove(userId, reason);
      } catch (error) {
        if (isDiscordError(error, RESTJSONErrorCodes.UnknownBan)) {
          logDenied(ctx, 'unban', interaction, userId, reason, 'not-banned');
          await replyError(ctx, interaction, 'That user is not banned.');
          return;
        }

        // Other API errors must reach the common error handler. Do not
        // misrepresent permission or network failures as an absent ban.
        throw error;
      }

      logAction(ctx, 'unban', interaction, userId, reason);

      const description = [
        `<@${userId}> (\`${userId}\`) has been unbanned.`,
        `**Reason:** ${reason ?? 'No reason provided.'}`,
        'The user may now rejoin the server with a valid invite.',
      ].join('\n');

      await confirmSuccess(ctx, interaction, successEmbed('User unbanned', description));
    });
  },
};

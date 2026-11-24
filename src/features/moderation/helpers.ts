import {
  DiscordAPIError,
  GuildMember,
  MessageFlags,
  RESTJSONErrorCodes,
  type ChatInputCommandInteraction,
  type EmbedBuilder,
  type Guild,
} from 'discord.js';
import type { AppContext } from '../../core/context.js';
import {
  canModerate,
  hasPermissions,
  moderationVerdictMessage,
  type HierarchyActor,
} from '../../core/permissions.js';
import { deferIfNeeded, isUnknownInteraction } from '../../core/responses.js';
import { errorEmbed } from '../../shared/embeds.js';

/**
 * Moderation plumbing shared by ban/kick/timeout/unban (PLAN §9).
 *
 * Reply helpers follow the same ack-aware state branching as
 * core/responses.ts (replied → followUp, deferred → editReply, fresh →
 * ephemeral reply, 10062 swallowed) but render embeds, which is what
 * moderation responses use. runModeration always defers ephemerally first,
 * so a deferred moderation interaction is private and editReply keeps it
 * that way.
 */

export function buildActor(member: GuildMember): HierarchyActor {
  return {
    id: member.id,
    highestRolePosition: member.roles.highest.position,
    isOwner: member.id === member.guild.ownerId,
  };
}

export function isDiscordError(error: unknown, code: number): boolean {
  return error instanceof DiscordAPIError && error.code === code;
}

function errorDetails(error: unknown): Record<string, unknown> {
  // Avoid logging complete Discord API errors, which may contain
  // sensitive request bodies or interaction webhook URLs.
  if (error instanceof DiscordAPIError) {
    return { errorName: error.name, discordCode: error.code, httpStatus: error.status };
  }
  return { errorName: error instanceof Error ? error.name : 'UnknownError' };
}

/**
 * Surface a moderation error exactly once, as an ephemeral embed. Response
 * failures are logged and swallowed: runModeration owns the error surface
 * end-to-end, and propagating would make the router attempt a second one.
 */
export async function replyError(
  ctx: AppContext,
  interaction: ChatInputCommandInteraction,
  message: string,
): Promise<void> {
  const embed = errorEmbed(message);
  try {
    if (interaction.replied) {
      await interaction.followUp({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
    } else if (interaction.deferred) {
      await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
    } else {
      await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
    }
  } catch (error) {
    if (isUnknownInteraction(error)) return;
    ctx.logger.error(
      {
        interactionId: interaction.id,
        command: interaction.commandName,
        ...errorDetails(error),
      },
      'Failed to send moderation error response',
    );
  }
}

/** Send a moderation success embed through whichever response state applies. */
export async function replySuccess(
  interaction: ChatInputCommandInteraction,
  embed: EmbedBuilder,
): Promise<void> {
  const options = { embeds: [embed], allowedMentions: { parse: [] } };
  if (interaction.replied) {
    await interaction.followUp(options);
  } else if (interaction.deferred) {
    await interaction.editReply(options);
  } else {
    await interaction.reply(options);
  }
}

/**
 * Phase 6 (G14): confirm a COMPLETED moderation action. A successful
 * ban whose confirmation message fails (classically 10062, the
 * interaction expired mid-action) must not be reported as a failed
 * action — the action stands, the delivery failure is warn-logged,
 * and the audit log keeps the success outcome.
 */
export async function confirmSuccess(
  ctx: AppContext,
  interaction: ChatInputCommandInteraction,
  embed: EmbedBuilder,
): Promise<void> {
  try {
    await replySuccess(interaction, embed);
  } catch (error) {
    ctx.logger.warn(
      {
        interactionId: interaction.id,
        command: interaction.commandName,
        ...errorDetails(error),
      },
      'Moderation action succeeded but its confirmation could not be delivered',
    );
  }
}

/**
 * Wrap a moderation command body: acknowledge ephemerally before any API
 * work, and convert unexpected failures into exactly one user-facing error.
 * A failed API response does not necessarily mean the action failed, so
 * unknown errors get deliberately ambiguous wording instead of "try again".
 */
export async function runModeration(
  ctx: AppContext,
  interaction: ChatInputCommandInteraction,
  action: string,
  execute: () => Promise<void>,
): Promise<void> {
  try {
    const ack = await deferIfNeeded(interaction, { ephemeral: true });
    if (ack === 'expired') return; // interaction is gone; nothing can be reported
    await execute();
  } catch (error) {
    ctx.logger.error(
      {
        action,
        interactionId: interaction.id,
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        ...errorDetails(error),
      },
      'Moderation command failed',
    );

    // Phase 6 (P2-07): the audit record distinguishes a Discord-refused
    // action (failed) from one whose outcome cannot be determined
    // (unknown) — previously only success/denied were ever recorded.
    if (isDiscordError(error, RESTJSONErrorCodes.MissingPermissions)) {
      logModeration(ctx, action, interaction, '', undefined, 'failed', 'missing-permissions');
      await replyError(
        ctx,
        interaction,
        'Discord denied this action because I lack the required permissions or role hierarchy.',
      );
      return;
    }

    if (isDiscordError(error, RESTJSONErrorCodes.UnknownMember)) {
      logModeration(ctx, action, interaction, '', undefined, 'unknown', 'unknown-member');
      await replyError(ctx, interaction, 'That member is no longer in this server.');
      return;
    }

    logModeration(ctx, action, interaction, '', undefined, 'unknown', 'unhandled-error');
    await replyError(
      ctx,
      interaction,
      'I could not confirm the moderation action. Please check the server state before trying again.',
    );
  }
}

/**
 * Fetch a guild member, returning null ONLY when Discord explicitly says
 * the user is not a member. Network and permission errors propagate —
 * treating them as "not a member" would bypass hierarchy checks.
 */
export async function fetchTargetMember(guild: Guild, userId: string): Promise<GuildMember | null> {
  try {
    return await guild.members.fetch({ user: userId, force: true });
  } catch (error) {
    if (isDiscordError(error, RESTJSONErrorCodes.UnknownMember)) {
      return null;
    }
    throw error;
  }
}

/**
 * Fetch the bot's own guild membership FRESH, replying the standard
 * error and returning null on failure (Phase 6c, cheap P2: factored
 * out of guardBotPermission/guardModeration, which each fetched it —
 * guardModeration paid for the same fetchMe TWICE per invocation).
 *
 * Phase 6 (★G7): guild.members.me reads the cache, and this tree
 * deliberately omits the GuildMembers intent — the cached member can
 * be absent or carry stale roles, so a permission guard built on it
 * is built on sand.
 */
async function fetchBotMember(
  ctx: AppContext,
  interaction: ChatInputCommandInteraction,
  guild: Guild,
): Promise<GuildMember | null> {
  try {
    return await guild.members.fetchMe({ force: true });
  } catch {
    await replyError(ctx, interaction, 'I could not resolve my server membership.');
    return null;
  }
}

/** Verify the bot itself holds the permission a moderation action needs. */
export async function guardBotPermission(
  ctx: AppContext,
  interaction: ChatInputCommandInteraction,
  requiredPermission: bigint,
  permissionName: string,
): Promise<boolean> {
  const guild = interaction.guild;
  if (guild === null) {
    await replyError(ctx, interaction, 'This command can only be used in a server.');
    return false;
  }

  const bot = await fetchBotMember(ctx, interaction, guild);
  if (bot === null) return false;

  if (!hasPermissions(bot.permissions, [requiredPermission])) {
    await replyError(
      ctx,
      interaction,
      `I need the ${permissionName} permission to perform this action.`,
    );
    return false;
  }

  return true;
}

/**
 * Full member-target guard: bot permission, invoker permission (defense in
 * depth — the router enforces policy too), and the canModerate hierarchy
 * verdict. Replies with the reason and returns false on any denial.
 */
export async function guardModeration(
  ctx: AppContext,
  interaction: ChatInputCommandInteraction,
  targetMember: GuildMember,
  requiredPermission: bigint,
  permissionName: string,
): Promise<boolean> {
  const guild = interaction.guild;
  if (guild === null) {
    await replyError(ctx, interaction, 'This command can only be used in a server.');
    return false;
  }

  if (targetMember.guild.id !== guild.id) {
    await replyError(ctx, interaction, 'That member does not belong to this server.');
    return false;
  }

  // Phase 6c (cheap P2): ONE bot-member fetch serves both the
  // permission check and the hierarchy verdict — the Phase 6 code
  // called guardBotPermission (which fetches) and then fetched AGAIN.
  const bot = await fetchBotMember(ctx, interaction, guild);
  if (bot === null) {
    return false;
  }
  if (!hasPermissions(bot.permissions, [requiredPermission])) {
    await replyError(
      ctx,
      interaction,
      `I need the ${permissionName} permission to perform this action.`,
    );
    return false;
  }

  // Cached guild interactions provide a GuildMember. Fetch a full
  // member when Discord supplies only a raw API interaction member.
  const invoker =
    interaction.member instanceof GuildMember
      ? interaction.member
      : await guild.members.fetch({ user: interaction.user.id, force: true });

  if (!hasPermissions(invoker.permissions, [requiredPermission])) {
    await replyError(
      ctx,
      interaction,
      `You need the ${permissionName} permission to perform this action.`,
    );
    return false;
  }

  const verdict = canModerate({
    invoker: buildActor(invoker),
    bot: buildActor(bot),
    target: buildActor(targetMember),
  });

  if (verdict !== 'ok') {
    await replyError(ctx, interaction, moderationVerdictMessage(verdict));
    return false;
  }

  return true;
}

type ModerationOutcome = 'success' | 'denied' | 'failed' | 'unknown';

function logModeration(
  ctx: AppContext,
  action: string,
  interaction: ChatInputCommandInteraction,
  targetId: string,
  reason: string | undefined,
  outcome: ModerationOutcome,
  detail?: string,
): void {
  ctx.logger.info(
    {
      action,
      outcome,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      interactionId: interaction.id,
      actorId: interaction.user.id,
      targetId,
      reason: reason ?? null,
      ...(detail !== undefined ? { detail } : {}),
    },
    outcome === 'success' ? 'Moderation action completed' : `Moderation action ${outcome}`,
  );
}

/** Audit-log a completed moderation action (PLAN §9: actions logged). */
export function logAction(
  ctx: AppContext,
  action: string,
  interaction: ChatInputCommandInteraction,
  target: string | { readonly id: string },
  reason?: string,
): void {
  logModeration(
    ctx,
    action,
    interaction,
    typeof target === 'string' ? target : target.id,
    reason,
    'success',
  );
}

/** Audit-log a moderation action a guard or validation refused. */
export function logDenied(
  ctx: AppContext,
  action: string,
  interaction: ChatInputCommandInteraction,
  targetId: string,
  reason: string | undefined,
  detail: string,
): void {
  logModeration(ctx, action, interaction, targetId, reason, 'denied', detail);
}

/**
 * Audit-log a ROUTER-level policy refusal (guild-only / owner-only /
 * permissions / cooldown) for a moderation command (Phase 6, P2-07):
 * router refusals used to bypass the feature audit log entirely, so a
 * denied ban attempt by an unauthorized user left no trace.
 */
export function logRouterDenial(
  ctx: AppContext,
  action: string,
  interaction: ChatInputCommandInteraction,
  reason: string,
): void {
  logModeration(ctx, action, interaction, '', undefined, 'denied', `router:${reason}`);
}

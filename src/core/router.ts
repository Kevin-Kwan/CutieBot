import {
  Events,
  type ChatInputCommandInteraction,
  type Interaction,
  type MessageComponentInteraction,
} from 'discord.js';
import type { AppContext } from './context.js';
import type { CommandPolicy, PolicyDenialReason } from './contracts.js';
import { serializeError } from './errors.js';
import { hasPermissions } from './permissions.js';
import { safeErrorReply } from './responses.js';

/**
 * The single interaction router (PLAN §5).
 *
 * Chat-input commands: lookup → policy checks (guildOnly, ownerOnly,
 * permission re-check) → anti-spam cooldown → execute inside try/catch with
 * ack-aware error surfacing (exactly one error reply, whatever state the
 * handler left the interaction in).
 *
 * Components: custom IDs are `feature:action:arg…`, dispatched through the
 * static registry — no dynamic require, no JSON custom IDs.
 *
 * Autocomplete: dispatched per command name; failures are logged and
 * swallowed (an autocomplete interaction cannot receive an error reply).
 */

export const UNKNOWN_COMMAND_MESSAGE = 'That command is no longer available.';
export const STALE_COMPONENT_MESSAGE = 'That control is no longer available.';
export const GUILD_ONLY_MESSAGE = 'That command can only be used in a server.';
export const OWNER_ONLY_MESSAGE = 'That command is restricted to the bot owner.';
export const MISSING_PERMISSIONS_MESSAGE = 'You do not have permission to use that command.';
export const GENERIC_ERROR_MESSAGE = 'Something went wrong while running that.';

export function cooldownMessage(remainingMs: number): string {
  return `Slow down — try that again in ${Math.ceil(remainingMs / 1000)}s.`;
}

/** Parse a `feature:action:arg…` component custom ID. */
export function parseComponentId(customId: string): { key: string; args: string[] } | null {
  const parts = customId.split(':');
  if (parts.length < 2) return null;
  const [feature, action, ...args] = parts;
  if (feature === undefined || feature === '' || action === undefined || action === '') {
    return null;
  }
  return { key: `${feature}:${action}`, args };
}

async function surfaceError(
  ctx: AppContext,
  interaction: ChatInputCommandInteraction | MessageComponentInteraction,
  error: unknown,
  what: string,
): Promise<void> {
  // P1-12: never log the raw error object — serialize + scrub first.
  ctx.logger.error(
    { err: serializeError(error), userId: interaction.user.id, guildId: interaction.guildId },
    `${what} failed`,
  );
  try {
    await safeErrorReply(interaction, GENERIC_ERROR_MESSAGE);
  } catch (replyError) {
    ctx.logger.error({ err: serializeError(replyError) }, 'failed to surface interaction error');
  }
}

/**
 * Notify the feature that the ROUTER refused an invocation (Phase 6,
 * P2-07) so privileged features can audit-log refusals that never reach
 * their execute(). A broken hook must never break the refusal itself.
 */
function notifyPolicyDenied(
  ctx: AppContext,
  policy: CommandPolicy,
  interaction: ChatInputCommandInteraction,
  reason: PolicyDenialReason,
): void {
  if (policy.onPolicyDenied === undefined) return;
  try {
    policy.onPolicyDenied(ctx, interaction, reason);
  } catch (error) {
    ctx.logger.error({ err: serializeError(error) }, 'policy denial hook failed');
  }
}

async function handleCommand(
  ctx: AppContext,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const command = ctx.registry.commands.get(interaction.commandName);
  if (command === undefined) {
    await safeErrorReply(interaction, UNKNOWN_COMMAND_MESSAGE);
    return;
  }

  const policy = command.policy ?? {};

  if (policy.guildOnly === true && interaction.guildId === null) {
    notifyPolicyDenied(ctx, policy, interaction, 'guild-only');
    await safeErrorReply(interaction, GUILD_ONLY_MESSAGE);
    return;
  }

  if (policy.ownerOnly === true && interaction.user.id !== ctx.config.ownerId) {
    notifyPolicyDenied(ctx, policy, interaction, 'owner-only');
    await safeErrorReply(interaction, OWNER_ONLY_MESSAGE);
    return;
  }

  if (
    policy.permissions !== undefined &&
    !hasPermissions(interaction.memberPermissions, policy.permissions)
  ) {
    notifyPolicyDenied(ctx, policy, interaction, 'permissions');
    await safeErrorReply(interaction, MISSING_PERMISSIONS_MESSAGE);
    return;
  }

  if (policy.cooldownMs !== undefined && policy.cooldownExempt?.(interaction) !== true) {
    const key = `command:${interaction.commandName}:${interaction.user.id}`;
    const remaining = ctx.cooldowns.hit(key, policy.cooldownMs);
    if (remaining > 0) {
      notifyPolicyDenied(ctx, policy, interaction, 'cooldown');
      await safeErrorReply(interaction, cooldownMessage(remaining));
      return;
    }
  }

  try {
    await command.execute(ctx, interaction);
  } catch (error) {
    await surfaceError(ctx, interaction, error, `command "${interaction.commandName}"`);
  }
}

async function handleComponent(
  ctx: AppContext,
  interaction: MessageComponentInteraction,
): Promise<void> {
  const parsed = parseComponentId(interaction.customId);
  const component = parsed === null ? undefined : ctx.registry.components.get(parsed.key);
  if (parsed === null || component === undefined) {
    await safeErrorReply(interaction, STALE_COMPONENT_MESSAGE);
    return;
  }

  // Phase 6 (P3): enforce each component's declared argument shape —
  // a well-formed key with garbage args is just as stale as a bad key.
  if (component.args !== undefined) {
    const { count, pattern } = component.args;
    const shapeOk =
      parsed.args.length === count &&
      (pattern === undefined || parsed.args.every((arg) => pattern.test(arg)));
    if (!shapeOk) {
      await safeErrorReply(interaction, STALE_COMPONENT_MESSAGE);
      return;
    }
  }

  try {
    await component.execute(ctx, interaction, parsed.args);
  } catch (error) {
    await surfaceError(ctx, interaction, error, `component "${parsed.key}"`);
  }
}

/** Route one interaction. Exported for tests; production uses attachRouter. */
export async function handleInteraction(ctx: AppContext, interaction: Interaction): Promise<void> {
  if (interaction.isChatInputCommand()) {
    await handleCommand(ctx, interaction);
    return;
  }

  if (interaction.isAutocomplete()) {
    const handler = ctx.registry.autocomplete.get(interaction.commandName);
    if (handler === undefined) return;
    try {
      await handler.execute(ctx, interaction);
    } catch (error) {
      ctx.logger.error(
        { err: serializeError(error), command: interaction.commandName },
        'autocomplete handler failed',
      );
    }
    return;
  }

  if (interaction.isMessageComponent()) {
    await handleComponent(ctx, interaction);
  }
}

/** Attach the router to the client's interactionCreate event. */
export function attachRouter(ctx: AppContext): void {
  ctx.client.on(Events.InteractionCreate, (interaction) => {
    void handleInteraction(ctx, interaction).catch((error: unknown) => {
      ctx.logger.error({ err: serializeError(error) }, 'unhandled router error');
    });
  });
}

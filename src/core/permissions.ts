import type { PermissionResolvable } from 'discord.js';

/**
 * Pure permission + role-hierarchy predicates (PLAN §5, §9).
 *
 * Kept free of discord.js objects (structural inputs only) so the moderation
 * matrix is unit-testable without a live guild.
 */

/**
 * Minimal structural view of anything that can check permission flags,
 * using discord.js's own PermissionResolvable so a real PermissionsBitField
 * (e.g. interaction.memberPermissions) satisfies it without adaptation.
 */
export interface PermissionHolder {
  has(permission: PermissionResolvable): boolean;
}

/** True when `holder` exists and holds every required permission flag. */
export function hasPermissions(
  holder: PermissionHolder | null | undefined,
  required: readonly bigint[],
): boolean {
  if (required.length === 0) return true;
  if (holder === null || holder === undefined) return false;
  // BitField.has accepts an array of resolvables and requires ALL of them.
  return holder.has(required);
}

/** Structural view of a guild member for hierarchy checks. */
export interface HierarchyActor {
  readonly id: string;
  /** Position of the member's highest role (higher wins). */
  readonly highestRolePosition: number;
  /** Guild owner — bypasses the invoker hierarchy check, never a valid target. */
  readonly isOwner: boolean;
}

export type ModerationVerdict =
  | 'ok'
  | 'self-target'
  | 'owner-target'
  | 'bot-target'
  | 'target-not-below-invoker'
  | 'target-not-below-bot';

/**
 * Decide whether `invoker` may moderate `target` in a guild where the bot
 * acts as `bot`. Deny-by-default ordering: self, owner, and the bot itself
 * are never valid targets; the target must sit strictly below both the
 * invoker (unless the invoker is the guild owner) and the bot.
 */
export function canModerate(args: {
  readonly invoker: HierarchyActor;
  readonly bot: HierarchyActor;
  readonly target: HierarchyActor;
}): ModerationVerdict {
  const { invoker, bot, target } = args;

  if (target.id === invoker.id) return 'self-target';
  if (target.isOwner) return 'owner-target';
  if (target.id === bot.id) return 'bot-target';

  if (!invoker.isOwner && target.highestRolePosition >= invoker.highestRolePosition) {
    return 'target-not-below-invoker';
  }
  if (target.highestRolePosition >= bot.highestRolePosition) {
    return 'target-not-below-bot';
  }
  return 'ok';
}

/** Human-readable explanation for a non-ok verdict (user-facing). */
export function moderationVerdictMessage(verdict: ModerationVerdict): string {
  switch (verdict) {
    case 'ok':
      return 'OK';
    case 'self-target':
      return 'You cannot moderate yourself.';
    case 'owner-target':
      return 'You cannot moderate the server owner.';
    case 'bot-target':
      return 'I cannot moderate myself.';
    case 'target-not-below-invoker':
      return 'You can only moderate members whose highest role is below yours.';
    case 'target-not-below-bot':
      return 'I can only moderate members whose highest role is below mine.';
  }
}

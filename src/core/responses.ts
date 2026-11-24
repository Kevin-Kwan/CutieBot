import {
  MessageFlags,
  type InteractionDeferReplyOptions,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
} from 'discord.js';

/**
 * Ack-aware reply helpers (PLAN §5).
 *
 * Discord interactions can be answered exactly once in each state:
 * not-acked → reply, deferred → editReply, replied → followUp. These helpers
 * branch on the interaction's response state so error handling never throws
 * "already acknowledged" / "not yet acknowledged" errors of its own.
 *
 * The interface uses discord.js's own option types; real interactions
 * satisfy it structurally, and tests cast hand-rolled fakes to it.
 */
export interface ReplyCapableInteraction {
  readonly replied: boolean;
  readonly deferred: boolean;
  reply(options: InteractionReplyOptions): Promise<unknown>;
  editReply(options: InteractionEditReplyOptions): Promise<unknown>;
  followUp(options: InteractionReplyOptions): Promise<unknown>;
  deferReply(options?: InteractionDeferReplyOptions): Promise<unknown>;
}

/** Discord API error 10062: the interaction token is gone (expired/unknown). */
export function isUnknownInteraction(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 10062;
}

/**
 * Surface an error to the user exactly once, using whichever response method
 * matches the interaction's current state. A 10062 (unknown interaction) is
 * swallowed — there is nobody left to show the error to. Any other failure
 * propagates so the caller can log it.
 */
export async function safeErrorReply(
  interaction: ReplyCapableInteraction,
  message: string,
): Promise<void> {
  try {
    if (interaction.replied) {
      await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
    } else if (interaction.deferred) {
      await interaction.editReply({ content: message });
    } else {
      await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    }
  } catch (error) {
    if (isUnknownInteraction(error)) return;
    throw error;
  }
}

/** Send a plain ephemeral reply, state-aware like safeErrorReply. */
export async function safeEphemeralReply(
  interaction: ReplyCapableInteraction,
  message: string,
): Promise<void> {
  await safeErrorReply(interaction, message);
}

/**
 * Outcome of an ack attempt (Phase 6, AUDIT6 P1-11). The old boolean
 * return conflated two very different states: 'already-acknowledged'
 * (safe to keep responding) and 'expired' (the interaction is dead —
 * the caller must perform NO further mutations, because any "success"
 * it produces can never be reported and may be a phantom).
 */
export type AckResult = 'deferred' | 'already-acknowledged' | 'expired';

/**
 * Defer the interaction if it has not been acknowledged yet. Slow commands
 * call this first so Discord's 3-second ack window never expires mid-work.
 * Callers must branch on the result: on 'expired', abort silently.
 */
export async function deferIfNeeded(
  interaction: ReplyCapableInteraction,
  options: { ephemeral?: boolean } = {},
): Promise<AckResult> {
  if (interaction.replied || interaction.deferred) return 'already-acknowledged';
  try {
    await interaction.deferReply(
      options.ephemeral === true ? { flags: MessageFlags.Ephemeral } : {},
    );
  } catch (error) {
    if (isUnknownInteraction(error)) return 'expired';
    throw error;
  }
  return 'deferred';
}

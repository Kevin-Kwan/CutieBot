import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  MessageComponentInteraction,
} from 'discord.js';
import type { AppContext } from './context.js';

/**
 * Handler contracts (PLAN §3, §5).
 *
 * One module shape for commands; separate contracts for components and
 * autocomplete. `data` is the minimal serialization contract — anything with
 * a `name` and a `toJSON()` (e.g. a SlashCommandBuilder) qualifies.
 */

/** Why the router refused an invocation before execute() ran. */
export type PolicyDenialReason = 'guild-only' | 'owner-only' | 'permissions' | 'cooldown';

export interface CommandPolicy {
  /** Discord permission flags the invoker must hold; re-checked by the router. */
  readonly permissions?: readonly bigint[];
  /** Anti-spam cooldown in milliseconds, keyed per user + command. */
  readonly cooldownMs?: number;
  /** Refuse to run outside a guild. */
  readonly guildOnly?: boolean;
  /** Only the configured OWNER_ID may run this command. */
  readonly ownerOnly?: boolean;
  /**
   * Return true to skip the router cooldown for this specific invocation
   * (Phase 6, P1-09: /ask reset must not share /ask chat's cooldown —
   * a user who just chatted still needs to be able to reset).
   */
  readonly cooldownExempt?: (interaction: ChatInputCommandInteraction) => boolean;
  /**
   * Called when the ROUTER refuses the invocation (Phase 6, P2-07), so
   * privileged features can audit-log refusals that never reach their
   * execute(). Must not throw; the router guards the call regardless.
   */
  readonly onPolicyDenied?: (
    ctx: AppContext,
    interaction: ChatInputCommandInteraction,
    reason: PolicyDenialReason,
  ) => void;
}

export interface CommandData {
  readonly name: string;
  /** Serialized registration payload (validated by the deploy script). */
  toJSON(): unknown;
}

export interface CommandModule {
  readonly data: CommandData;
  readonly policy?: CommandPolicy;
  execute(ctx: AppContext, interaction: ChatInputCommandInteraction): Promise<void>;
}

/**
 * Component handler. Registered under a `feature:action` key; the router
 * parses custom IDs of the form `feature:action:arg1:arg2…` and passes the
 * trailing segments as `args`.
 */
/** Declared argument shape for a component's custom-ID args (Phase 6, P3). */
export interface ComponentArgSpec {
  /** Exact number of `:`-separated args after the key. */
  readonly count: number;
  /** Every arg must match this pattern (e.g. a session ID's charset). */
  readonly pattern?: RegExp;
}

export interface ComponentModule {
  /** Registry key, e.g. "music:skip". Must not contain the arg segments. */
  readonly key: string;
  /** When set, the router refuses custom IDs whose args don't match. */
  readonly args?: ComponentArgSpec;
  execute(
    ctx: AppContext,
    interaction: MessageComponentInteraction,
    args: readonly string[],
  ): Promise<void>;
}

/** Autocomplete handler, registered per command name. */
export interface AutocompleteModule {
  readonly command: string;
  execute(ctx: AppContext, interaction: AutocompleteInteraction): Promise<void>;
}

import type { ChatInputCommandInteraction, User } from 'discord.js';
import type { AppContext } from '../../../core/context.js';
import { deferIfNeeded } from '../../../core/responses.js';
import { errorEmbed } from '../../../shared/embeds.js';
import { EconomyError } from '../economy.repo.js';
import { economyFromContext, type EconomyActor, type EconomyService } from '../economy.service.js';

/** Map a discord.js User to the economy layer's actor shape. */
export function actorOf(user: User): EconomyActor {
  return { id: user.id, bot: user.bot };
}

/**
 * Run an economy command body: build the service from the context, defer
 * the reply first (every old economy command deferred before touching the
 * DB), and render expected EconomyErrors as error embeds. Anything else
 * propagates to the router's generic error surface.
 *
 * Phase 6: the defer goes through deferIfNeeded (G4 — this was the one
 * runner still calling raw deferReply), an expired interaction aborts
 * the command with NO database mutation (P1-11), and responses use
 * editReply — the deferred reply IS the response. The Phase 5 code
 * used followUp for it, which left interaction.replied false and let
 * a later error overwrite the delivered answer via safeErrorReply
 * (G14).
 */
export async function runEconomy(
  ctx: AppContext,
  interaction: ChatInputCommandInteraction,
  body: (service: EconomyService) => Promise<void>,
): Promise<void> {
  const service = economyFromContext(ctx);
  const ack = await deferIfNeeded(interaction);
  if (ack === 'expired') return;
  try {
    await body(service);
  } catch (error) {
    if (error instanceof EconomyError) {
      await interaction.editReply({ embeds: [errorEmbed(error.message)] });
      return;
    }
    throw error;
  }
}

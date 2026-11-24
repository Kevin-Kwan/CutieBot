import { EmbedBuilder } from 'discord.js';

/**
 * Shared embed builders + money formatting (PLAN layout: src/shared).
 *
 * The old bot built embeds inline in every command with ad-hoc colors —
 * mostly 0x00ff00 green for economy output and #F1C40F yellow for the pay
 * confirmation. One brand color everywhere now.
 */

export const BRAND_COLOR = 0x00ff00;
export const ERROR_COLOR = 0xff3b30;

/**
 * Format an integer amount the way the old bot printed it: `$ 1,234`.
 * Phase 6c (R2): bigint amounts (exact leaderboard net worth) format
 * without a lossy Number conversion.
 */
export function formatMoney(amount: number | bigint): string {
  if (typeof amount === 'bigint') return `$ ${amount.toLocaleString('en-US')}`;
  return `$ ${Math.trunc(amount).toLocaleString('en-US')}`;
}

/**
 * Exact net worth (Phase 6e, R2): wallet + bank computed in BigInt.
 * The components are individually capped at MAX_SAFE_INTEGER, so
 * their SUM can exceed the safe range — adding them as JS numbers
 * silently rounded the total (GPT's executed case: MAX_SAFE_INTEGER
 * + 2 rendered …992 instead of …993). Presentation sites use this
 * helper; the leaderboard already aggregates exactly (Decimal128).
 */
export function netWorth(account: { readonly wallet: number; readonly bank: number }): bigint {
  return BigInt(account.wallet) + BigInt(account.bank);
}

export function successEmbed(title: string, description?: string): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(BRAND_COLOR).setTitle(title);
  if (description !== undefined) embed.setDescription(description);
  return embed;
}

export function errorEmbed(message: string): EmbedBuilder {
  return new EmbedBuilder().setColor(ERROR_COLOR).setTitle('Error').setDescription(message);
}

/** Economy-flavoured embed (brand color + optional field list). */
export function economyEmbed(
  title?: string,
  description?: string,
  fields?: readonly { name: string; value: string; inline?: boolean }[],
): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(BRAND_COLOR);
  if (title !== undefined) embed.setTitle(title);
  if (description !== undefined) embed.setDescription(description);
  if (fields !== undefined && fields.length > 0) {
    embed.addFields(fields.map((field) => ({ ...field, inline: field.inline ?? false })));
  }
  return embed;
}

/** Human-readable remaining time for cooldown messages, e.g. "3h 12m". */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (parts.length === 0 || (days === 0 && hours === 0 && seconds > 0)) {
    parts.push(`${seconds}s`);
  }
  return parts.join(' ');
}

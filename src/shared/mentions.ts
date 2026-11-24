import type { MessageMentionOptions } from 'discord.js';

/**
 * The one safe mention default for bot output (Phase 6, P2-08): parse
 * NOTHING and never ping the replied-to user. Any bot message carrying
 * user- or extractor-controlled text (AI replies, track titles, queue
 * posts) must send with these options — a title or prompt containing
 * `@everyone` must never become a real ping.
 */
export const NO_MENTIONS: MessageMentionOptions = { parse: [], repliedUser: false };

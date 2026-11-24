import type { MessageMentionOptions } from 'discord.js';
import { NO_MENTIONS } from '../../shared/mentions.js';
import { chunkMessage } from './chunk.js';

export { NO_MENTIONS };

/**
 * AI reply delivery (PLAN §8): every chunk of every AI reply is sent
 * with `allowedMentions: { parse: [], repliedUser: false }`, so model
 * output can never ping a user, a role, or @everyone — and never the
 * user being replied to either (Phase 6, AUDIT6 P2-08). The model
 * writes the text, it does not get to choose who gets notified. Long
 * replies are split with the code-fence-aware chunker and sent
 * strictly in order.
 */

export interface AiSendOptions {
  readonly content: string;
  readonly allowedMentions: MessageMentionOptions;
}

/** Shown if a provider ever yields text the chunker reduces to nothing. */
export const EMPTY_REPLY_TEXT = '(no response)';

/** Split a reply into send-ready option objects, one per chunk, in order. */
export function chunkedOptions(text: string): AiSendOptions[] {
  const chunks = chunkMessage(text);
  const texts = chunks.length > 0 ? chunks : [EMPTY_REPLY_TEXT];
  return texts.map((content) => ({ content, allowedMentions: NO_MENTIONS }));
}

/**
 * Send a reply through `send`, chunk by chunk, in order. The callback
 * picks the transport per chunk (editReply then followUp for /ask;
 * reply then channel.send for message triggers). Returns the number
 * of chunks sent.
 */
export async function deliverChunks(
  text: string,
  send: (options: AiSendOptions, index: number) => Promise<void>,
): Promise<number> {
  const options = chunkedOptions(text);
  for (let index = 0; index < options.length; index += 1) {
    const chunk = options[index];
    if (chunk === undefined) continue;
    await send(chunk, index);
  }
  return options.length;
}

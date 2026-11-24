import { describe, expect, it } from 'vitest';
import {
  EMPTY_REPLY_TEXT,
  chunkedOptions,
  deliverChunks,
  type AiSendOptions,
} from '../../../src/features/ai/deliver.js';

/**
 * Payload tests for AI reply delivery (PLAN §8): every chunk of every
 * AI reply must carry allowedMentions { parse: [], repliedUser: false } — model output can
 * never ping anyone — and chunks must be sent in order, each within
 * Discord's 2000-character limit.
 */
describe('deliverChunks', () => {
  it('sends a short reply as one chunk with mentions fully disabled', async () => {
    const sent: AiSendOptions[] = [];
    const count = await deliverChunks('hello there', async (options) => {
      sent.push(options);
    });
    expect(count).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.content).toBe('hello there');
    expect(sent[0]?.allowedMentions).toEqual({ parse: [], repliedUser: false });
  });

  it('splits a >2000-char reply with a code fence into ordered, mention-safe chunks', async () => {
    const codeLines = Array.from({ length: 300 }, (_, i) => `const value${i} = ${i};`).join('\n');
    const text = `Here is the code you asked for:\n\`\`\`ts\n${codeLines}\n\`\`\`\nThat is all of it.`;
    expect(text.length).toBeGreaterThan(4_000);

    const sent: { options: AiSendOptions; index: number }[] = [];
    const count = await deliverChunks(text, async (options, index) => {
      sent.push({ options, index });
    });

    expect(count).toBeGreaterThanOrEqual(3);
    expect(sent.map((entry) => entry.index)).toEqual(sent.map((_, i) => i)); // strictly in order
    for (const { options } of sent) {
      expect(options.allowedMentions).toEqual({ parse: [], repliedUser: false });
      expect(options.content.length).toBeLessThanOrEqual(2_000);
      expect(options.content.length).toBeGreaterThan(0);
    }
    // Order is real: the intro leads, the outro lands last, and the
    // code survives in sequence across the seams.
    expect(sent[0]?.options.content.startsWith('Here is the code')).toBe(true);
    expect(sent.at(-1)?.options.content.endsWith('That is all of it.')).toBe(true);
    const reassembled = sent.map((entry) => entry.options.content).join('\n');
    expect(reassembled).toContain('const value0 = 0;');
    expect(reassembled).toContain('const value299 = 299;');
    expect(reassembled.indexOf('const value0 = 0;')).toBeLessThan(
      reassembled.indexOf('const value299 = 299;'),
    );
  });

  it('falls back to a placeholder chunk for blank text instead of sending nothing', async () => {
    const sent: AiSendOptions[] = [];
    await deliverChunks('   ', async (options) => {
      sent.push(options);
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.content).toBe(EMPTY_REPLY_TEXT);
    expect(sent[0]?.allowedMentions).toEqual({ parse: [], repliedUser: false });
  });

  it('chunkedOptions produces exactly the payload deliverChunks sends', () => {
    const options = chunkedOptions('a'.repeat(2_500));
    expect(options).toHaveLength(2);
    for (const option of options) {
      expect(option.allowedMentions).toEqual({ parse: [], repliedUser: false });
    }
  });
});

import { describe, expect, it } from 'vitest';
import { chunkMessage } from '../../../src/features/ai/chunk.js';

function assertWithinLimit(chunks: readonly string[], limit: number): void {
  for (const chunk of chunks) {
    expect(chunk.length).toBeLessThanOrEqual(limit);
    expect(chunk.length).toBeGreaterThan(0);
  }
}

describe('chunkMessage', () => {
  it('returns a single chunk for short text', () => {
    const chunks = chunkMessage('hello world');
    expect(chunks).toEqual(['hello world']);
  });

  it('returns [] for empty and whitespace-only input', () => {
    expect(chunkMessage('')).toEqual([]);
    expect(chunkMessage('   \n\t  ')).toEqual([]);
  });

  it('returns the text unchanged when exactly at the limit', () => {
    const text = 'a'.repeat(2_000);
    expect(chunkMessage(text)).toEqual([text]);
  });

  it('splits at a newline boundary', () => {
    const first = 'line one\nline two\nline three';
    const chunks = chunkMessage(`${first}\n${'x'.repeat(30)}`, 20);
    assertWithinLimit(chunks, 20);
    expect(chunks.join('\n')).toContain('line one');
    expect(chunks.join(' ')).toContain('line three');
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('splits at spaces when no newline is available', () => {
    const text = 'alpha beta gamma delta epsilon zeta eta theta';
    const chunks = chunkMessage(text, 12);
    assertWithinLimit(chunks, 12);
    // Phase 6: seams are lossless — concatenation reproduces the input.
    expect(chunks.join('')).toBe(text);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('hard-splits a single over-long word', () => {
    const word = 'a'.repeat(25);
    const chunks = chunkMessage(word, 10);
    assertWithinLimit(chunks, 10);
    expect(chunks).toEqual(['aaaaaaaaaa', 'aaaaaaaaaa', 'aaaaa']);
    expect(chunks.join('')).toBe(word);
  });

  it('closes and reopens a fenced block, preserving the language tag', () => {
    const code = 'const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;';
    const text = `\`\`\`ts\n${code}\n\`\`\``;
    const chunks = chunkMessage(text, 30);
    assertWithinLimit(chunks, 30);
    expect(chunks.length).toBeGreaterThan(1);
    // Every chunk that is inside the fence is re-opened, and every
    // chunk that ends inside the fence is closed.
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.trimEnd().endsWith('```')).toBe(true);
    }
    for (const chunk of chunks.slice(1)) {
      expect(chunk.startsWith('```ts\n') || chunk.startsWith('```\n')).toBe(true);
    }
    // Reassembled (stripping the synthetic fence markers per chunk)
    // the code is unchanged — Phase 6 chunking is lossless, so plain
    // concatenation after stripping reproduces it exactly.
    const reassembled = chunks
      .map((chunk) =>
        chunk
          .replace(/^```ts\n/, '')
          .replace(/^```\n/, '')
          .replace(/\n```$/, ''),
      )
      .join('');
    expect(reassembled).toBe(code);
  });

  it('never produces a chunk over the limit, even with fences', () => {
    const code = Array.from({ length: 20 }, (_, i) => `const x${i} = ${i};`).join('\n');
    const text = `Intro line.\n\`\`\`js\n${code}\n\`\`\`\nOutro line.`;
    for (const limit of [25, 40, 100, 2_000]) {
      const chunks = chunkMessage(text, limit);
      assertWithinLimit(chunks, limit);
      expect(chunks.length).toBeGreaterThan(0);
    }
  });

  it('never produces empty chunks', () => {
    const text = 'word '.repeat(50).trim();
    const chunks = chunkMessage(text, 10);
    expect(chunks.every((chunk) => chunk.length > 0)).toBe(true);
    expect(chunks).not.toContain('');
  });

  it('handles a fence that fits entirely in one chunk', () => {
    const text = '```ts\nconst a = 1;\n```';
    expect(chunkMessage(text, 2_000)).toEqual([text]);
  });
});

// Phase 6 regression suite (AUDIT6 P1-04 / G1): the previous chunker
// never returned for a fenced block containing an unbroken line longer
// than the limit, and could lose content at seams. These tests pin
// termination, the size bound, and losslessness.
describe('chunkMessage — Phase 6 regressions', () => {
  it('terminates on a fenced block with a 10,000-char unbroken line', () => {
    const text = `\`\`\`ts\n${'x'.repeat(10_000)}\n\`\`\``;
    const chunks = chunkMessage(text, 2_000);
    assertWithinLimit(chunks, 2_000);
    expect(chunks.length).toBeGreaterThan(4);
    // Lossless modulo the synthetic close/reopen pairs at the seams.
    const reassembled = chunks.join('').replaceAll('\n```' + '```ts\n', '');
    expect(reassembled).toBe(text);
  });

  it('terminates on a 2,500-char line inside a fence, within the limit', () => {
    const text = `before\n\`\`\`ts\n${'y'.repeat(2_500)}\n\`\`\`\nafter`;
    const chunks = chunkMessage(text, 2_000);
    assertWithinLimit(chunks, 2_000);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('handles inputs at the limit boundary (limit-2 .. limit, over by 1-2)', () => {
    for (const length of [1_998, 1_999, 2_000, 2_001, 2_002]) {
      const text = 'a'.repeat(length);
      const chunks = chunkMessage(text, 2_000);
      assertWithinLimit(chunks, 2_000);
      expect(chunks.join('')).toBe(text);
    }
  });

  it('handles unicode content without splitting surrogate pairs apart', () => {
    const text = '🎧'.repeat(1_500); // 3,000 UTF-16 code units
    const chunks = chunkMessage(text, 2_000);
    assertWithinLimit(chunks, 2_000);
    expect(chunks.join('')).toBe(text);
  });

  it('property: random-ish texts always terminate, stay within limit, and are lossless', () => {
    // Deterministic LCG so the "random" cases are stable in CI.
    let seed = 42;
    const rand = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    const pieces = ['word ', 'two words ', 'line\n', 'long'.repeat(40), '\n', 'x'.repeat(300), ' '];
    for (let trial = 0; trial < 25; trial++) {
      let text = '';
      const target = 500 + Math.floor(rand() * 4_000);
      while (text.length < target) {
        text += pieces[Math.floor(rand() * pieces.length)];
      }
      text = text.trim();
      if (text.length === 0) continue;
      for (const limit of [50, 137, 2_000]) {
        const chunks = chunkMessage(text, limit);
        assertWithinLimit(chunks, limit);
        expect(chunks.join('')).toBe(text);
      }
    }
  });

  it('property: fenced texts stay within limit and keep every chunk fence-balanced', () => {
    const body = Array.from({ length: 60 }, (_, i) => `const v${i} = ${'z'.repeat(i % 37)};`).join(
      '\n',
    );
    const text = `intro\n\`\`\`js\n${body}\n\`\`\`\noutro`;
    for (const limit of [64, 200, 2_000]) {
      const chunks = chunkMessage(text, limit);
      assertWithinLimit(chunks, limit);
      // Every chunk renders standalone: counting fence lines per chunk
      // (open with tag / bare close) must end balanced.
      for (const chunk of chunks) {
        let open = false;
        for (const line of chunk.split('\n')) {
          const match = /^ {0,3}```+(.*)$/.exec(line);
          if (match === null) continue;
          const info = (match[1] ?? '').trim();
          if (!open) open = true;
          else if (info === '') open = false;
        }
        expect(open).toBe(false);
      }
    }
  });
});

// Phase 6c regression suite (re-audit R4 / Gemini B1): the Phase 6
// rewrite measured the synthetic closing marker BEFORE shrinking the
// segment, so a shrink that removed a trailing newline grew the marker
// from 3 to 4 chars and emitted a 2,001-char chunk (Discord 400s), and
// its hard cuts could bisect a UTF-16 surrogate pair. Both re-audits
// reproduced these against the Phase 6 build; the exact inputs are
// pinned here.
describe('chunkMessage — Phase 6c re-audit regressions (R4)', () => {
  /** No chunk may start with a lone low surrogate or end with a lone high one. */
  function assertNoSplitSurrogates(chunks: readonly string[]): void {
    for (const chunk of chunks) {
      const first = chunk.charCodeAt(0);
      const last = chunk.charCodeAt(chunk.length - 1);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
      expect(first >= 0xdc00 && first <= 0xdfff).toBe(false);
    }
  }

  it('GPT input A: a blank line at the fence window edge never yields a 2,001-char chunk', () => {
    const text = '```\n' + 'x'.repeat(1993) + '\n\n\n' + 'y'.repeat(100) + '\n```';
    const chunks = chunkMessage(text, 2_000);
    assertWithinLimit(chunks, 2_000);
    expect(chunks.map((chunk) => chunk.length)).not.toContain(2_001);
  });

  it("Gemini's exact input stays within the limit at 2000 and at 20", () => {
    const text = '```ts\n' + 'x'.repeat(1992) + '\n\nmore';
    const chunks = chunkMessage(text, 2_000);
    assertWithinLimit(chunks, 2_000);
    expect(chunks[0]?.length).toBeLessThanOrEqual(2_000);

    const small = chunkMessage('```ts\n' + 'x'.repeat(12) + '\n\nmore stuff here', 20);
    assertWithinLimit(small, 20);
  });

  it('GPT input B: a hard cut never bisects a surrogate pair', () => {
    const text = 'a'.repeat(1999) + '😀' + 'b'.repeat(100);
    const chunks = chunkMessage(text, 2_000);
    assertWithinLimit(chunks, 2_000);
    assertNoSplitSurrogates(chunks);
    expect(chunks.join('')).toBe(text);
  });

  it('property: astral text without fences is lossless, within limit, surrogate-safe', () => {
    let seed = 7;
    const rand = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    const pieces = ['😀', '🎧🎧', 'word ', '\n\n', 'x'.repeat(53), 'é', 'a'];
    for (let trial = 0; trial < 25; trial++) {
      let text = '';
      const target = 200 + Math.floor(rand() * 3_000);
      while (text.length < target) text += pieces[Math.floor(rand() * pieces.length)];
      text = text.trim();
      if (text.length === 0) continue;
      for (const limit of [37, 200, 2_000]) {
        const chunks = chunkMessage(text, limit);
        assertWithinLimit(chunks, limit);
        assertNoSplitSurrogates(chunks);
        expect(chunks.join('')).toBe(text);
      }
    }
  });

  it('property: fenced text with blank lines and astral chars stays within limit, surrogate-safe', () => {
    let seed = 99;
    const rand = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    const pieces = ['😀', 'line of code;\n', '\n', 'x'.repeat(41), '🎧', 'ok\n'];
    for (let trial = 0; trial < 25; trial++) {
      let body = '';
      const target = 300 + Math.floor(rand() * 3_000);
      while (body.length < target) body += pieces[Math.floor(rand() * pieces.length)];
      const text = '```ts\n' + body + '\n```';
      for (const limit of [64, 200, 2_000]) {
        const chunks = chunkMessage(text, limit);
        assertWithinLimit(chunks, limit);
        assertNoSplitSurrogates(chunks);
      }
    }
  });
});

// Phase 6e (R4): GPT's executed case — the language tag is 31 a's plus
// an astral emoji, so the 32-char reopen-tag cap lands mid-emoji. The
// Phase 6c chunker sliced the tag raw and emitted a lone surrogate
// INSIDE the reopened fence prefix (the edge-only surrogate assertions
// above cannot see it). The truncation now backs off like content cuts.
describe('chunkMessage — Phase 6e re-audit regression (R4)', () => {
  function hasLoneSurrogate(s: string): boolean {
    for (let i = 0; i < s.length; i += 1) {
      const c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        const next = s.charCodeAt(i + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      }
      if (c >= 0xdc00 && c <= 0xdfff) {
        const prev = s.charCodeAt(i - 1);
        if (!(prev >= 0xd800 && prev <= 0xdbff)) return true;
      }
    }
    return false;
  }

  it("GPT's exact input: astral char at the reopen-tag cap splits no surrogate", () => {
    const input = '```' + 'a'.repeat(31) + '😀\n' + 'x'.repeat(3000) + '\n```';
    const chunks = chunkMessage(input);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2_000);
      expect(hasLoneSurrogate(chunk)).toBe(false);
    }
    // The reopened fence tag is well-formed: backticks + 31 a's (the
    // emoji backed off whole, not bisected).
    const reopened = chunks[1];
    expect(reopened?.startsWith('```' + 'a'.repeat(31) + '\n')).toBe(true);
  });
});

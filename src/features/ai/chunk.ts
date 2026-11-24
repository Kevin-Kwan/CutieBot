/**
 * Discord message chunking for AI replies (PLAN §8).
 *
 * Splits text into chunks of at most `limit` characters (Discord's 2000),
 * preferring newline/space boundaries, and keeps Markdown code fences
 * balanced: a chunk that ends inside a fenced block is closed, and the
 * next chunk re-opens the fence with its language tag, so every chunk
 * renders as valid Markdown on its own.
 *
 * Phase 6 rewrite (AUDIT6 P1-04 / G1 — the previous implementation could
 * loop forever on a fenced block containing an unbroken line longer
 * than the limit, and could drop content at seams). This version is a
 * forward-only cursor over the source:
 *
 * - the cursor strictly advances on every iteration (hard-cut fallback),
 *   so termination is structural, not incidental;
 * - fence state is tracked incrementally while scanning each segment —
 *   emitted chunks are never rescanned (the old code re-joined and
 *   re-scanned all prior chunks every iteration, O(n²) and the source
 *   of the seam-fusion misreads);
 * - when a segment ends inside a fence, the segment is shrunk until
 *   prefix + segment + close fits, RE-MEASURING the close after every
 *   adjustment — the close is 3 chars after a trailing newline and 4
 *   otherwise, and a shrink can remove that newline (Phase 6c, R4:
 *   measuring once, before the shrink, produced 2,001-char chunks);
 * - hard cuts never bisect a UTF-16 surrogate pair (Phase 6c, R4);
 * - the split is LOSSLESS: no source character is ever dropped. The
 *   only insertions are the synthetic close/reopen fence markers, so
 *   stripping those markers and concatenating the chunks reproduces
 *   the input exactly.
 *
 * Fence semantics follow CommonMark for triple-backtick fences: a
 * fence line with an info string opens a block; inside a block, only
 * a bare fence line closes it. (Longer backtick runs are treated as
 * fences too; exact run-length matching is not attempted.)
 */

const DEFAULT_LIMIT = 2000;
/** '\n```' — the longest synthetic close appended to a mid-fence chunk. */
const CLOSE_MAX = 4;
/** Reopen tags longer than this are truncated (rendering only). */
const MAX_REOPEN_TAG = 32;

function isBlank(text: string): boolean {
  return text.trim().length === 0;
}

/**
 * Back a cut off by one code unit when it would land BETWEEN the two
 * halves of a surrogate pair (Phase 6c, R4 — GPT's input B: the Phase 6
 * hard cut bisected 😀 into a lone high surrogate ending one chunk and
 * a lone low surrogate starting the next, which Discord renders as
 * replacement glyphs). Only applies when a following segment exists;
 * a cut of 1 is left alone (a degenerate limit cannot do better).
 */
function avoidSurrogateSplit(text: string, pos: number, cut: number): number {
  if (cut <= 1) return cut;
  const end = pos + cut;
  if (end >= text.length) return cut;
  const before = text.charCodeAt(end - 1);
  const after = text.charCodeAt(end);
  const splitsPair = before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
  return splitsPair ? cut - 1 : cut;
}

const FENCE_LINE = /^ {0,3}```+(.*)$/;

/**
 * Advance the fence state across one segment's COMPLETE lines.
 * `segment` may end mid-line (hard cut); the trailing partial line is
 * not evaluated — a fence delimiter only counts once its line is whole.
 * `endsComplete` says the segment ends exactly at a line boundary or
 * at end-of-text, making its last line complete too.
 */
function scanFenceState(
  segment: string,
  endsComplete: boolean,
  initial: string | null,
): string | null {
  let state = initial;
  const lines = segment.split('\n');
  const completeCount = endsComplete ? lines.length : lines.length - 1;
  for (let i = 0; i < completeCount; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const match = FENCE_LINE.exec(line);
    if (match === null) continue;
    const info = (match[1] ?? '').trim();
    if (info.includes('`')) continue; // not a valid info string
    if (state === null) {
      state = info;
    } else if (info === '') {
      state = null;
    }
    // A fence line WITH an info string inside a block is content.
  }
  return state;
}

export function chunkMessage(text: string, limit = DEFAULT_LIMIT): string[] {
  if (!Number.isFinite(limit) || limit < 1) {
    throw new RangeError('limit must be a finite number >= 1');
  }
  const lim = Math.floor(limit);
  if (isBlank(text)) {
    return [];
  }
  if (text.length <= lim) {
    return [text];
  }

  const chunks: string[] = [];
  let pos = 0;
  /** Fence tag open in the SOURCE at `pos`, or null when outside a fence. */
  let openTag: string | null = null;
  /** Once true, synthetic markers no longer fit and are abandoned. */
  let markersAbandoned = false;

  while (pos < text.length) {
    // Phase 6e (R4): the reopen tag truncation must not bisect an
    // astral character in the language tag — a raw slice at
    // MAX_REOPEN_TAG emitted a lone surrogate into the reopened fence
    // (GPT's executed case). Back off with the same surrogate guard
    // the content cuts use. This was the chunker's only remaining
    // synthetic-string slice; every other cut already goes through
    // avoidSurrogateSplit.
    const reopenTag =
      openTag === null
        ? ''
        : openTag.slice(
            0,
            avoidSurrogateSplit(openTag, 0, Math.min(openTag.length, MAX_REOPEN_TAG)),
          );
    let prefix = openTag !== null && !markersAbandoned ? `\`\`\`${reopenTag}\n` : '';
    if (prefix.length > 0 && lim - prefix.length - CLOSE_MAX < 1) {
      // Degenerate limit: the reopen marker cannot fit alongside any
      // content plus a close. Abandon synthetic markers for the rest
      // of the message rather than ever exceeding the limit.
      markersAbandoned = true;
      prefix = '';
    }

    const remaining = text.length - pos;
    if (remaining <= lim - prefix.length) {
      // Final segment: emit the rest verbatim (plus the reopen prefix).
      chunks.push(prefix + text.slice(pos));
      break;
    }

    const budget = lim - prefix.length;
    const window = text.slice(pos, pos + budget);
    // Prefer a newline seam, then a space seam; the separator stays at
    // the head of the next segment so nothing is lost. Fall back to a
    // hard cut — this is what guarantees the cursor always advances,
    // including on an unbroken line longer than the limit.
    let cut = window.lastIndexOf('\n');
    if (cut < 1) cut = window.lastIndexOf(' ');
    if (cut < 1) cut = window.length;
    cut = avoidSurrogateSplit(text, pos, cut);

    let segment = text.slice(pos, pos + cut);
    let endsComplete = text[pos + cut] === '\n' || pos + cut === text.length;
    let endState = scanFenceState(segment, endsComplete, openTag);

    if (endState !== null && !markersAbandoned) {
      // Phase 6c (R4 / Gemini B1): the closing marker's length depends
      // on the segment's FINAL character — '```' (3) when it ends in a
      // newline, '\n```' (4) otherwise — and shrinking the segment can
      // change that character. The Phase 6 code measured the marker
      // BEFORE the shrink, so a shrink that removed a trailing newline
      // emitted a chunk one character over the limit (both re-audits
      // reproduced a 2,001-char chunk at the 2,000 limit). Loop:
      // measure against the CURRENT segment, shrink by the overflow,
      // re-measure, until prefix + segment + close fits.
      while (endState !== null) {
        const close = segment.endsWith('\n') ? '```' : '\n```';
        const overflow = prefix.length + segment.length + close.length - lim;
        if (overflow <= 0) break;
        if (overflow >= cut) {
          // No room for even one content char plus the close.
          markersAbandoned = true;
          break;
        }
        cut -= overflow;
        cut = avoidSurrogateSplit(text, pos, cut);
        segment = text.slice(pos, pos + cut);
        endsComplete = text[pos + cut] === '\n' || pos + cut === text.length;
        endState = scanFenceState(segment, endsComplete, openTag);
      }
      if (endState !== null && !markersAbandoned) {
        chunks.push(prefix + segment + (segment.endsWith('\n') ? '```' : '\n```'));
        openTag = endState;
        pos += cut;
        continue;
      }
      // The shrink consumed the fence-opening line (endState is now
      // null): fall through and push the current segment plainly.
    }

    chunks.push(prefix + segment);
    openTag = endState;
    pos += cut;
  }

  return chunks;
}

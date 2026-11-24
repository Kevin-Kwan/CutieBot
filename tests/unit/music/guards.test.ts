import { describe, expect, it } from 'vitest';
import {
  queueVerdict,
  voiceVerdict,
  type QueueSnapshot,
} from '../../../src/features/music/guards.js';

describe('voiceVerdict', () => {
  it('refuses when the invoker is not in voice', () => {
    expect(voiceVerdict({ memberChannelId: null, botChannelId: null }).ok).toBe(false);
    expect(voiceVerdict({ memberChannelId: null, botChannelId: 'vc-1' }).ok).toBe(false);
  });

  it('allows any channel when the bot is not connected', () => {
    expect(voiceVerdict({ memberChannelId: 'vc-1', botChannelId: null })).toEqual({ ok: true });
  });

  it('requires the same channel when the bot is connected', () => {
    expect(voiceVerdict({ memberChannelId: 'vc-1', botChannelId: 'vc-1' })).toEqual({ ok: true });
    const verdict = voiceVerdict({ memberChannelId: 'vc-2', botChannelId: 'vc-1' });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.error).toMatch(/same voice channel/);
  });
});

describe('queueVerdict', () => {
  const active: QueueSnapshot = { exists: true, hasCurrent: true, paused: false, upcoming: 3 };
  const idle: QueueSnapshot = { exists: true, hasCurrent: false, paused: false, upcoming: 0 };

  it('refuses when there is no queue', () => {
    expect(queueVerdict(null, 'exists').ok).toBe(false);
    expect(queueVerdict({ ...idle, exists: false }, 'exists').ok).toBe(false);
    expect(queueVerdict(null, 'active').ok).toBe(false);
  });

  it('exists-needing commands accept an idle queue', () => {
    expect(queueVerdict(idle, 'exists')).toEqual({ ok: true });
    expect(queueVerdict(active, 'exists')).toEqual({ ok: true });
  });

  it('active-needing commands require a loaded track', () => {
    expect(queueVerdict(active, 'active')).toEqual({ ok: true });
    expect(queueVerdict(idle, 'active').ok).toBe(false);
  });

  it('a paused track still counts as active', () => {
    expect(queueVerdict({ ...active, paused: true }, 'active')).toEqual({ ok: true });
  });
});

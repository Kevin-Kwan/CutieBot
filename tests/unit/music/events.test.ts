import { describe, expect, it } from 'vitest';
import { createLogger } from '../../../src/core/logger.js';
import { sendNowPlaying } from '../../../src/features/music/events.js';
import type { MusicQueue } from '../../../src/features/music/queue.js';

const silentLogger = createLogger('silent');
import { fakeTrack } from '../../fixtures/music.js';

/**
 * Phase 6 (P1-13): sendNowPlaying is invoked with `void` from the
 * playerStart handler — it must NEVER reject, even when embed building
 * explodes on extractor-controlled data.
 */
describe('sendNowPlaying', () => {
  it('resolves even when the progress bar builder throws', async () => {
    const queue = {
      id: 'guild-events-1',
      currentTrack: fakeTrack(),
      channel: { name: 'General' },
      metadata: {
        channel: { send: async () => ({}) },
        requestedById: 'user-1',
        sessionId: 'aaaaaaaabbbb',
      },
      node: {
        createProgressBar: () => {
          throw new Error('extractor garbage');
        },
        volume: 75,
        isPaused: () => false,
      },
      repeatMode: 0,
    } as unknown as MusicQueue;
    await expect(sendNowPlaying(queue, silentLogger)).resolves.toBeUndefined();
  });

  it('resolves even when the channel post rejects', async () => {
    const queue = {
      id: 'guild-events-2',
      currentTrack: fakeTrack(),
      channel: { name: 'General' },
      metadata: {
        channel: {
          send: async () => {
            throw new Error('Missing Permissions');
          },
        },
        requestedById: 'user-1',
        sessionId: 'aaaaaaaabbbb',
      },
      node: {
        createProgressBar: () => '▬▬▬',
        volume: 75,
        isPaused: () => false,
      },
      repeatMode: 0,
    } as unknown as MusicQueue;
    await expect(sendNowPlaying(queue, silentLogger)).resolves.toBeUndefined();
  });
});

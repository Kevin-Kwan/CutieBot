import { describe, expect, it } from 'vitest';
import { parseArgs, validatePayload } from '../../scripts/deploy-commands.js';
import { buildRegistry } from '../../src/features/index.js';
import { pingCommand } from '../../src/features/utility/commands/ping.js';

describe('ping command serialization', () => {
  it('serializes to a valid Discord payload entry', () => {
    const json = pingCommand.data.toJSON() as { name?: unknown; description?: unknown };
    expect(json.name).toBe('ping');
    expect(typeof json.description).toBe('string');
    expect((json.description as string).length).toBeGreaterThan(0);
  });

  it('the live manifest payload passes validation', () => {
    const payload = buildRegistry().commandPayload();
    // 5 utility (incl. /botinvite, Phase 6) + 20 economy (Phases 1–2)
    // + 4 moderation + 3 admin (Phase 3) + 19 music (Phase 4 + /clear,
    // Phase 6) + 1 AI /ask (Phase 5).
    expect(payload).toHaveLength(52);
    expect(() => validatePayload(payload)).not.toThrow();
  });
});

describe('validatePayload', () => {
  it('refuses an empty manifest', () => {
    expect(() => validatePayload([])).toThrow(/empty command manifest/);
  });

  it('refuses duplicate names', () => {
    const entry = { name: 'ping', description: 'x' };
    expect(() => validatePayload([entry, entry])).toThrow(/Duplicate command name/);
  });

  it('refuses invalid names and descriptions', () => {
    expect(() => validatePayload([{ name: 'Ping!', description: 'x' }])).toThrow(
      /Invalid command name/,
    );
    expect(() => validatePayload([{ name: 'ping', description: '' }])).toThrow(
      /Invalid description/,
    );
    expect(() => validatePayload([{ name: 'ping', description: 'x'.repeat(101) }])).toThrow(
      /Invalid description/,
    );
    expect(() => validatePayload(['not-an-object'])).toThrow(/not an object/);
  });

  it('refuses more than 100 commands', () => {
    const payload = Array.from({ length: 101 }, (_, i) => ({
      name: `cmd${i}`,
      description: 'x',
    }));
    expect(() => validatePayload(payload)).toThrow(/limit of 100/);
  });
});

describe('parseArgs', () => {
  it('parses --dry-run', () => {
    expect(parseArgs(['--dry-run'])).toEqual({
      guildId: undefined,
      global: false,
      dryRun: true,
    });
  });

  it('parses --guild with a value', () => {
    expect(parseArgs(['--guild', '123456'])).toMatchObject({ guildId: '123456' });
  });

  it('rejects --guild without a value and conflicting targets', () => {
    expect(() => parseArgs(['--guild'])).toThrow(/requires a guild ID/);
    expect(() => parseArgs(['--global', '--guild', '1'])).toThrow(/either --global or --guild/);
  });

  it('rejects unknown arguments', () => {
    expect(() => parseArgs(['--wat'])).toThrow(/Unknown argument/);
  });
});

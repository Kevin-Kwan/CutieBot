import { describe, expect, it } from 'vitest';
import { EnvError } from '../../src/config/env.js';
import {
  scrubCredentials,
  serializeError,
  UNTRUSTED_ERROR_MESSAGE,
} from '../../src/core/errors.js';

describe('serializeError', () => {
  // SUPERSEDED in Phase 6e (R7): this asserted an unknown TypeError's
  // message was projected verbatim. GPT's re-review executed
  // credential leaks through unknown-error messages (JSON credentials,
  // URL userinfo — pinned below), so unknown errors now project
  // WITHOUT their message; trusted first-party errors keep theirs.
  it('withholds the message of an unknown (untrusted) Error', () => {
    expect(serializeError(new TypeError('boom'))).toEqual({
      name: 'TypeError',
      message: UNTRUSTED_ERROR_MESSAGE,
    });
  });

  it('keeps the scrubbed message of a trusted first-party error (EnvError)', () => {
    const out = serializeError(new EnvError(['DISCORD_TOKEN', 'MONGO_URI']));
    expect(out.name).toBe('EnvError');
    expect(out.message).toContain('DISCORD_TOKEN');
    expect(out.message).toContain('Missing required environment variables');
  });

  // SUPERSEDED in Phase 6e (R7): numeric code/status are still carried
  // (safe categories), but the unknown error's message is no longer
  // projected alongside them.
  it('carries numeric discord code / http status when present', () => {
    const err = Object.assign(new Error('Unknown interaction'), { code: 10062 });
    expect(serializeError(err)).toEqual({
      name: 'Error',
      message: UNTRUSTED_ERROR_MESSAGE,
      code: 10062,
    });
    const httpErr = Object.assign(new Error('nope'), { status: 503 });
    expect(serializeError(httpErr).status).toBe(503);
  });

  // SUPERSEDED in Phase 6g (R7): this asserted a thrown string and a
  // thrown number were projected VERBATIM ('plain string', '42').
  // GPT's final confirmation showed the non-Error branch leaking
  // credentials, so non-Error values now get the unknown projection:
  // fixed category + withheld message. Names and the never-throws
  // guarantee are unchanged.
  it('handles non-Error thrown values without throwing', () => {
    expect(serializeError('plain string').message).toBe(UNTRUSTED_ERROR_MESSAGE);
    expect(serializeError('plain string').name).toBe('NonErrorThrown');
    expect(serializeError(null).name).toBe('NonErrorThrown');
    expect(serializeError(42).message).toBe(UNTRUSTED_ERROR_MESSAGE);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => serializeError(circular)).not.toThrow();
    expect(serializeError(circular).message).toBe(UNTRUSTED_ERROR_MESSAGE);
  });
});

describe('scrubCredentials', () => {
  it('redacts MongoDB credentials in connection strings', () => {
    const out = scrubCredentials('connect failed mongodb://admin:s3cret@db.internal:27017/app');
    expect(out).not.toContain('s3cret');
    expect(out).toContain('[redacted]');
    expect(out).toContain('db.internal');
  });

  it('redacts bearer tokens and OpenAI keys', () => {
    expect(scrubCredentials('Authorization: Bearer abc.def.ghi')).not.toContain('abc.def.ghi');
    expect(scrubCredentials('key sk-proj-1234567890abcdef rejected')).not.toContain(
      'sk-proj-1234567890abcdef',
    );
  });

  it('redacts discord webhook tokens and key=value secrets', () => {
    const out = scrubCredentials(
      'post https://discord.com/api/webhooks/123456/abcdef-token failed, token=xyz123',
    );
    expect(out).not.toContain('abcdef-token');
    expect(out).not.toContain('xyz123');
  });

  it('leaves ordinary messages untouched', () => {
    expect(scrubCredentials('user 42 timed out after 30s')).toBe('user 42 timed out after 30s');
  });
});

// Phase 6c (R7): the Phase 6 scrubber had three demonstrated bypasses
// (GPT executed it against sentinel inputs) plus the sk- capture-group
// bug Gemini found. All pinned here.
describe('scrubCredentials — Phase 6c re-audit regressions (R7)', () => {
  it('redacts VERSIONED discord webhook URLs (/api/v10/webhooks/…)', () => {
    const out = scrubCredentials(
      'post https://discord.com/api/v10/webhooks/123456789/SECRET-WEBHOOK-TOKEN failed',
    );
    expect(out).not.toContain('SECRET-WEBHOOK-TOKEN');
    expect(out).toContain('[redacted]');
  });

  it('redacts every value in a multi-cookie header, not just the first', () => {
    const out = scrubCredentials('Cookie: session=FIRST-SECRET; auth=SECOND-SECRET; theme=dark');
    expect(out).not.toContain('FIRST-SECRET');
    expect(out).not.toContain('SECOND-SECRET');
  });

  it('redacts sk- keys without injecting the match offset (Gemini)', () => {
    const out = scrubCredentials('key sk-abcdefghij1234567890 rejected');
    expect(out).not.toContain('sk-abcdefghij1234567890');
    expect(out).not.toMatch(/\d+\[redacted\]/); // no numeric offset glued to the marker
    expect(out).toContain('[redacted]');
  });

  it('redacts an Authorization header line in full', () => {
    const out = scrubCredentials('Authorization: Basic dXNlcjpwYXNz sent');
    expect(out).not.toContain('dXNlcjpwYXNz');
  });
});

describe('serializeError — structured thrown objects (R7)', () => {
  // SUPERSEDED in Phase 6g (R7): this asserted the thrown object was
  // serialized with sensitive KEYS redacted and benign content
  // ('request failed') preserved. GPT's final confirmation leaked a
  // credential through a non-Error object's message STRING — key
  // redaction cannot see inside string values — so thrown objects
  // are no longer serialized AT ALL: nothing of the value survives,
  // benign or otherwise.
  it('withholds a thrown object entirely — no key or value survives (Phase 6g)', () => {
    const thrown = {
      message: 'request failed',
      config: { headers: { Authorization: 'Bearer NESTED-SECRET', 'x-trace': 'ok' } },
      token: 'TOP-LEVEL-SECRET',
      nested: [{ password: 'DEEP-SECRET' }],
    };
    const out = serializeError(thrown);
    expect(out.message).toBe(UNTRUSTED_ERROR_MESSAGE);
    const whole = JSON.stringify(out);
    expect(whole).not.toContain('NESTED-SECRET');
    expect(whole).not.toContain('TOP-LEVEL-SECRET');
    expect(whole).not.toContain('DEEP-SECRET');
    expect(whole).not.toContain('request failed');
  });

  it('a thrown object whose message embeds a versioned webhook URL never surfaces it', () => {
    const thrown = {
      url: 'https://discord.com/api/v9/webhooks/42/EMBEDDED-SECRET',
      error: 'delivery failed',
    };
    const out = serializeError(thrown);
    expect(out.message).toBe(UNTRUSTED_ERROR_MESSAGE);
    expect(JSON.stringify(out)).not.toContain('EMBEDDED-SECRET');
  });
});

// Phase 6e (R7): GPT's targeted re-review executed three more leaks
// against the Phase 6c serializer. Each is pinned here, plus the
// any-scheme userinfo scrub for trusted messages.
describe('serializeError — Phase 6e re-audit regressions (R7)', () => {
  // SUPERSEDED in Phase 6g (R7): this asserted the beyond-cap subtree
  // was replaced by '[truncated]' in the serialized output. Phase 6g
  // removed arbitrary-object serialization from the logging path
  // entirely, so there is no output for a placeholder to appear in —
  // the stronger guarantee is that the message is the withheld
  // constant and the sentinel appears nowhere.
  it('a credential key nested beyond the old depth cap never surfaces (Phase 6g)', () => {
    let deep: Record<string, unknown> = { token: 'DEEP-NESTED-SENTINEL' };
    for (let i = 0; i < 8; i += 1) deep = { level: deep };
    const out = serializeError(deep);
    expect(JSON.stringify(out)).not.toContain('DEEP-NESTED-SENTINEL');
    expect(out.message).toBe(UNTRUSTED_ERROR_MESSAGE);
  });

  it('JSON-formatted credentials in an unknown Error message are withheld with the message', () => {
    const out = serializeError(new Error('auth failed: {"token":"JSON-CRED-SENTINEL"}'));
    expect(out.message).not.toContain('JSON-CRED-SENTINEL');
    expect(out.message).toBe(UNTRUSTED_ERROR_MESSAGE);
  });

  it('credentials in an https URL userinfo inside an unknown Error message never surface', () => {
    const out = serializeError(
      new Error('GET https://svc-user:HTTPS-URL-SENTINEL@api.example.com/v1 failed'),
    );
    expect(out.message).not.toContain('HTTPS-URL-SENTINEL');
    expect(out.message).toBe(UNTRUSTED_ERROR_MESSAGE);
  });

  it('the scrubber redacts userinfo for any URL scheme (trusted-message defense-in-depth)', () => {
    const scrubbed = scrubCredentials('GET https://svc-user:p4ssw0rd@api.example.com/v1 failed');
    expect(scrubbed).not.toContain('p4ssw0rd');
    expect(scrubbed).toContain('[redacted]@api.example.com');
  });
});

// Phase 6g (R7): GPT's final confirmation executed the Phase 6e
// serializer against NON-Error thrown values and leaked credentials
// — the allowlist projection covered Error instances only, while the
// non-Error branch still stringified the value. The unknown
// projection now applies to every untrusted thrown value, whatever
// its JavaScript type.
describe('serializeError — Phase 6g non-Error projection (R7)', () => {
  it("GPT's exact case: a plain object whose message is JSON carrying a password", () => {
    const out = serializeError({
      message: JSON.stringify({ password: 'SENTINEL-EXAMPLE-CREDENTIAL' }),
      code: 401,
    });
    // The sentinel is gone, the fixed category and the validated
    // numeric code survive, and the message is the withheld constant.
    expect(JSON.stringify(out)).not.toContain('SENTINEL-EXAMPLE-CREDENTIAL');
    expect(out).toEqual({
      name: 'NonErrorThrown',
      message: UNTRUSTED_ERROR_MESSAGE,
      code: 401,
    });
  });

  it('a thrown string containing a credential is withheld in full', () => {
    const out = serializeError('auth failed for SENTINEL-STRING-CREDENTIAL');
    expect(JSON.stringify(out)).not.toContain('SENTINEL-STRING-CREDENTIAL');
    expect(out).toEqual({ name: 'NonErrorThrown', message: UNTRUSTED_ERROR_MESSAGE });
  });

  it('a thrown object with a credential-looking top-level KEY leaks neither key nor value', () => {
    const out = serializeError({ password: 'SENTINEL-KEY-CREDENTIAL', note: 'innocent' });
    const whole = JSON.stringify(out);
    expect(whole).not.toContain('SENTINEL-KEY-CREDENTIAL');
    expect(whole).not.toContain('password');
    expect(whole).not.toContain('innocent');
    expect(out.message).toBe(UNTRUSTED_ERROR_MESSAGE);
  });

  it('a non-Error object with a numeric status carries it, still without content', () => {
    const out = serializeError({ status: 503, detail: 'SENTINEL-STATUS-DETAIL' });
    expect(out.status).toBe(503);
    expect(JSON.stringify(out)).not.toContain('SENTINEL-STATUS-DETAIL');
    expect(out.message).toBe(UNTRUSTED_ERROR_MESSAGE);
  });
});

describe('logger output carries no sentinels (R7)', () => {
  it('an error logged through the real pino logger + serializeError leaks nothing', async () => {
    const { createLogger } = await import('../../src/core/logger.js');
    const lines: string[] = [];
    const stream = {
      write(chunk: string): boolean {
        lines.push(chunk);
        return true;
      },
    };
    const logger = createLogger('info', stream);
    const sentinelError = Object.assign(
      new Error(
        'hook https://discord.com/api/v10/webhooks/1/SENTINEL-WEBHOOK failed, Cookie: a=SENTINEL-COOKIE',
      ),
      { token: 'SENTINEL-FIELD' },
    );
    logger.error({ err: serializeError(sentinelError), token: 'SENTINEL-FIELD' }, 'test log line');
    const output = lines.join('');
    expect(output).not.toContain('SENTINEL-WEBHOOK');
    expect(output).not.toContain('SENTINEL-COOKIE');
    expect(output).not.toContain('SENTINEL-FIELD');
    expect(output).toContain('test log line');
  });
});

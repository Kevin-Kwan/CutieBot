/**
 * Centralized safe error serialization for logs (Phase 6, AUDIT6 P1-12;
 * hardened in Phase 6c, R7; allowlist projection completed in Phase 6e,
 * R7 after GPT's targeted re-review executed three more bypasses).
 *
 * Raw error objects must never reach the logger outside the paths that
 * already project them (moderation's errorDetails): provider SDK errors,
 * Mongo errors, and HTTP errors can embed credentials — connection
 * strings with passwords, Authorization headers, API keys, webhook URLs,
 * request bodies. `serializeError` is an ALLOWLIST projection — name,
 * numeric code/status, and a message ONLY when the error is first-party
 * (see TrustedMessageError); an Error's own enumerable properties (where
 * SDKs stash request configs and headers) are never copied. Trusted
 * messages still pass through `scrubCredentials` as defense-in-depth,
 * and the pino redact config in logger.ts is a third layer for fields
 * logged directly.
 *
 * Phase 6e (R7) — why the projection is now the boundary, not the
 * scrubber. GPT executed the Phase 6c serializer and leaked credentials
 * three more ways, each pinned by a regression test:
 * - a credential key nested beyond the deep-redaction depth cap: the
 *   redactor returned the ORIGINAL subtree verbatim past the cap, so
 *   the secret was serialized untouched. Beyond the cap the subtree is
 *   now replaced by the '[truncated]' placeholder, never returned;
 * - JSON-formatted credentials inside an UNKNOWN Error's message: key
 *   redaction applies to thrown objects, not Error messages, and no
 *   regex list can cover arbitrary third-party message text. Unknown
 *   errors therefore project WITHOUT their message (name + numeric
 *   code/status only); only TrustedMessageError subclasses — the
 *   codebase's own error classes, whose messages are constructed from
 *   safe parts — keep a (scrubbed) message;
 * - credentials in a generic URL's userinfo (https://user:pass@host):
 *   the scrubber's userinfo pattern only knew mongodb schemes; it now
 *   covers any scheme.
 *
 * Phase 6c fixes retained: versioned Discord webhook URLs
 * (/api/v10/webhooks/…) are matched; Authorization/Cookie/
 * Set-Cookie header lines are redacted to end-of-line; the sk- pattern
 * uses a fixed replacement string (no phantom capture-group reference).
 *
 * Phase 6g (R7) — the projection now covers NON-Error thrown values
 * too. GPT's final confirmation executed the Phase 6e serializer
 * against `serializeError({message: JSON.stringify({password: …}),
 * code: 401})` and against a thrown string: the non-Error branch
 * still stringified the (key-redacted) value, so a credential riding
 * inside a `message` STRING — invisible to key redaction — survived,
 * and a thrown string was logged verbatim. JavaScript promises can
 * reject with anything; an unknown rejection is not necessarily an
 * Error. Non-Error values therefore get the SAME projection as
 * unknown Errors: the fixed 'NonErrorThrown' category, a validated
 * numeric code/status when the value is an object carrying one, and
 * the withheld-message constant. NO part of the thrown value — its
 * message field, its string body, its nested keys — is serialized.
 * With arbitrary objects out of the logging path entirely, the
 * Phase 6c/6e deep-redaction walk (and its '[truncated]' depth
 * placeholder) is gone: there is nothing left to redact. The
 * scrubber remains as defense-in-depth for TRUSTED messages only.
 */

export interface SerializedError {
  readonly name: string;
  readonly message: string;
  /** Discord API error code (e.g. 10062) when the error carries one. */
  readonly code?: number;
  /** HTTP status when the error carries one. */
  readonly status?: number;
}

/**
 * Base class for FIRST-PARTY errors whose message is safe to serialize
 * (Phase 6e, R7). The codebase's own error roots extend this —
 * EnvError, EconomyError (and every economy subclass), MusicError,
 * AiProviderError, LimiterRefused — because their messages are built
 * by our code from safe parts (variable NAMES, user-facing economy and
 * music strings, an HTTP status number), never copied out of a
 * third-party exception. Everything else — SDK errors, Mongo errors,
 * discord.js errors, arbitrary throws — is UNKNOWN: serializeError
 * projects it to name + numeric code/status with the message withheld,
 * because third-party message text can embed credentials in shapes no
 * scrubber can enumerate.
 */
export class TrustedMessageError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Message placeholder for errors that are not TrustedMessageError. */
export const UNTRUSTED_ERROR_MESSAGE = '[message withheld: untrusted error]';

const CREDENTIAL_PATTERNS: readonly (readonly [RegExp, string])[] = [
  // URL userinfo, any scheme: scheme://user:pass@host (mongodb(+srv),
  // https, …). The host survives; the credentials do not.
  [/([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^@\s]+@/gi, '$1[redacted]@'],
  // Discord webhook URLs, versioned or not: /api/webhooks/<id>/<token>
  // and /api/v10/webhooks/<id>/<token> (the token is the credential).
  [/(discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/\d+\/)[A-Za-z0-9._-]+/gi, '$1[redacted]'],
  // Authorization / Cookie / Set-Cookie header lines: the whole value
  // goes, to end of line — a cookie header carries MANY values.
  [
    /\b(authorization|proxy-authorization|cookie|set-cookie)(\s*[:=]\s*)[^\n\r]+/gi,
    '$1$2[redacted]',
  ],
  // Bearer tokens.
  [/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]'],
  // OpenAI-style API keys (fixed replacement string — no group ref).
  [/\bsk-[A-Za-z0-9_-]{10,}/g, '[redacted]'],
  // key=value style secrets in messages (bare keys; quoted JSON keys
  // are projected to the withheld-message constant instead).
  [/((?:api[-_]?key|token|password|passwd|secret)\s*[:=]\s*)[^\s,;}]+/gi, '$1[redacted]'],
];

export function scrubCredentials(text: string): string {
  let out = text;
  for (const [pattern, replacement] of CREDENTIAL_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function numericField(error: object, key: 'code' | 'status'): number | undefined {
  const value = (error as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Project any thrown value into a log-safe record. Never throws. */
export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    const code = numericField(error, 'code');
    const status = numericField(error, 'status');
    if (error instanceof TrustedMessageError) {
      // First-party error: the message is ours and safe by
      // construction; it still passes the scrubber as defense-in-depth.
      return {
        name: error.name,
        message: scrubCredentials(error.message),
        ...(code !== undefined ? { code } : {}),
        ...(status !== undefined ? { status } : {}),
      };
    }
    // Unknown/third-party error (Phase 6e, R7): project to the safe
    // category only — name plus numeric code/status. The message is
    // WITHHELD, not scrubbed: GPT demonstrated JSON-formatted
    // credentials and URL userinfo surviving every regex in an
    // arbitrary exception message, so message text from code we do
    // not control is not loggable, full stop.
    return {
      name: error.name,
      message: UNTRUSTED_ERROR_MESSAGE,
      ...(code !== undefined ? { code } : {}),
      ...(status !== undefined ? { status } : {}),
    };
  }
  // Phase 6g (R7): non-Error thrown values get the SAME unknown
  // projection as unknown Errors above. The Phase 6e branch
  // stringified the key-redacted value, which still leaked: a
  // credential inside a `message` STRING is invisible to key
  // redaction (GPT executed exactly that construction), and a thrown
  // string was logged verbatim. An arbitrary rejection is untrusted
  // regardless of its JavaScript type, so only the fixed category,
  // a validated numeric code/status, and the withheld-message
  // constant survive — the value's own content never serializes.
  if (typeof error === 'object' && error !== null) {
    const code = numericField(error, 'code');
    const status = numericField(error, 'status');
    return {
      name: 'NonErrorThrown',
      message: UNTRUSTED_ERROR_MESSAGE,
      ...(code !== undefined ? { code } : {}),
      ...(status !== undefined ? { status } : {}),
    };
  }
  return { name: 'NonErrorThrown', message: UNTRUSTED_ERROR_MESSAGE };
}

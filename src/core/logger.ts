import { pino, type DestinationStream, type Logger } from 'pino';

export type AppLogger = Logger;

/**
 * Pino logger factory (PLAN §11). Pretty printing stays off (structured JSON
 * logs for Fly), timestamps are ISO strings.
 *
 * Phase 6 (AUDIT6 P1-12): defense-in-depth redaction. Call sites should log
 * names/ids and serialize errors through core/errors.ts — but any secret
 * that still reaches the logger under a known key is censored here:
 * credential fields at any depth, plus auth/cookie headers.
 *
 * Phase 6c (R7): an optional destination stream (tests capture real
 * logger output through it to prove no sentinel secret survives the
 * serializeError + redact pipeline).
 */
export function createLogger(level: string, destination?: DestinationStream): AppLogger {
  return pino(
    {
      level,
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label) => ({ level: label }),
      },
      redact: {
        paths: [
          'token',
          'discordToken',
          'mongoUri',
          'openaiApiKey',
          'youtubeCookie',
          'password',
          'secret',
          'apiKey',
          'cookie',
          'authorization',
          '*.token',
          '*.discordToken',
          '*.mongoUri',
          '*.openaiApiKey',
          '*.youtubeCookie',
          '*.password',
          '*.secret',
          '*.apiKey',
          '*.cookie',
          '*.authorization',
          'req.headers.authorization',
          'req.headers.cookie',
          'headers.authorization',
          'headers.cookie',
        ],
        censor: '[redacted]',
      },
    },
    destination,
  );
}

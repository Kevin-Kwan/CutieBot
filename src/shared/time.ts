/**
 * Long-form uptime formatting: "1 days, 2 hours, 3 minutes, 4 seconds".
 *
 * The legacy bot duplicated this math in uptime.js and both botinfo.js
 * copies (AUDIT §5.34); it lives here once now. Distinct from
 * `formatDuration` in embeds.ts, which renders compact cooldown strings
 * like "3h 12m".
 */
export function formatUptime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${days} days, ${hours} hours, ${minutes} minutes, ${seconds} seconds`;
}

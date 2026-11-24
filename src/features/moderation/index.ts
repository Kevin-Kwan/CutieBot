import type { FeatureManifest } from '../index.js';
import { banCommand } from './commands/ban.js';
import { kickCommand } from './commands/kick.js';
import { timeoutCommand } from './commands/timeout.js';
import { unbanCommand } from './commands/unban.js';

/** Moderation feature manifest (PLAN §9): ban, kick, timeout, unban. */
export const moderationManifest: FeatureManifest = {
  commands: [banCommand, kickCommand, timeoutCommand, unbanCommand],
  components: [],
  autocomplete: [],
};

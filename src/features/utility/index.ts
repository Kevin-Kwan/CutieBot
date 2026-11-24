import type { FeatureManifest } from '../index.js';
import { avatarCommand } from './commands/avatar.js';
import { botinviteCommand } from './commands/botinvite.js';
import { botinfoCommand } from './commands/botinfo.js';
import { pingCommand } from './commands/ping.js';
import { uptimeCommand } from './commands/uptime.js';

/** Utility feature manifest: ping, botinfo, uptime, avatar, botinvite. */
export const utilityManifest: FeatureManifest = {
  commands: [pingCommand, botinfoCommand, uptimeCommand, avatarCommand, botinviteCommand],
  components: [],
  autocomplete: [],
};

import type { FeatureManifest } from '../index.js';
import { restartCommand } from './commands/restart.js';
import { setavatarCommand } from './commands/setavatar.js';
import { setusernameCommand } from './commands/setusername.js';

/** Admin feature manifest — all owner-only (router policy). */
export const adminManifest: FeatureManifest = {
  commands: [restartCommand, setavatarCommand, setusernameCommand],
  components: [],
  autocomplete: [],
};

import type { FeatureManifest } from '../index.js';
import { backCommand } from './commands/back.js';
import { clearCommand } from './commands/clear.js';
import { jumpCommand } from './commands/jump.js';
import { leaveCommand } from './commands/leave.js';
import { loopCommand } from './commands/loop.js';
import { moveCommand } from './commands/move.js';
import { nowplayingCommand } from './commands/nowplaying.js';
import { pauseCommand } from './commands/pause.js';
import { playCommand } from './commands/play.js';
import { playnextCommand } from './commands/playnext.js';
import { queueCommand } from './commands/queue.js';
import { removeCommand } from './commands/remove.js';
import { resumeCommand } from './commands/resume.js';
import { searchCommand } from './commands/search.js';
import { seekCommand } from './commands/seek.js';
import { shuffleCommand } from './commands/shuffle.js';
import { skipCommand } from './commands/skip.js';
import { stopCommand } from './commands/stop.js';
import { volumeCommand } from './commands/volume.js';
import { controllerComponents } from './components/controller.js';
import { searchSelectComponent } from './components/search-select.js';

/**
 * Music feature manifest (PLAN §7): 19 commands + controller components +
 * the search select menu. No /lyrics — the legacy tree never had one
 * (see PHASE4.md). /clear was restored in Phase 6 for legacy parity.
 */
export const musicManifest: FeatureManifest = {
  commands: [
    playCommand,
    playnextCommand,
    searchCommand,
    queueCommand,
    nowplayingCommand,
    skipCommand,
    backCommand,
    pauseCommand,
    resumeCommand,
    stopCommand,
    leaveCommand,
    seekCommand,
    volumeCommand,
    shuffleCommand,
    loopCommand,
    removeCommand,
    moveCommand,
    jumpCommand,
    clearCommand,
  ],
  components: [...controllerComponents, searchSelectComponent],
  autocomplete: [],
};

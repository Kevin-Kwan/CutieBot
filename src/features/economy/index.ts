import type { FeatureManifest } from '../index.js';
import { addmoneyCommand } from './commands/addmoney.js';
import { balanceCommand } from './commands/balance.js';
import { bankCommand } from './commands/bank.js';
import { buyCommand } from './commands/buy.js';
import { coinflipCommand } from './commands/coinflip.js';
import { dailyCommand, monthlyCommand, weeklyCommand } from './commands/claims.js';
import { depositCommand } from './commands/deposit.js';
import { diceCommand } from './commands/dice.js';
import { inventoryCommand } from './commands/inventory.js';
import { leaderboardCommand } from './commands/leaderboard.js';
import { payCommand } from './commands/pay.js';
import { removemoneyCommand } from './commands/removemoney.js';
import { robCommand } from './commands/rob.js';
import { rouletteCommand } from './commands/roulette.js';
import { sellCommand } from './commands/sell.js';
import { shopCommand } from './commands/shop.js';
import { slotsCommand } from './commands/slots.js';
import { withdrawCommand } from './commands/withdraw.js';

/** Economy feature manifest — all 20 commands (the old economy set, rebuilt). */
export const economyManifest: FeatureManifest = {
  commands: [
    balanceCommand,
    bankCommand,
    depositCommand,
    withdrawCommand,
    dailyCommand,
    weeklyCommand,
    monthlyCommand,
    payCommand,
    leaderboardCommand,
    coinflipCommand,
    diceCommand,
    rouletteCommand,
    slotsCommand,
    robCommand,
    shopCommand,
    buyCommand,
    sellCommand,
    inventoryCommand,
    addmoneyCommand,
    removemoneyCommand,
  ],
  components: [],
  autocomplete: [],
};

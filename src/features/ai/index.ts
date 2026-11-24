import type { FeatureManifest } from '../index.js';
import { askCommand } from './commands/ask.js';

/**
 * AI feature manifest: just /ask. The mention/reply message handler
 * is not a registry module — it attaches to MessageCreate in
 * src/index.ts via attachAiMessageHandler (messages.ts).
 */
export const aiManifest: FeatureManifest = {
  commands: [askCommand],
  components: [],
  autocomplete: [],
};

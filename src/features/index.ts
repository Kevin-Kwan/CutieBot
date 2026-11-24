import type { AutocompleteModule, CommandModule, ComponentModule } from '../core/contracts.js';
import {
  createRegistry,
  registerAutocomplete,
  registerCommand,
  registerComponent,
  type Registry,
} from '../core/registry.js';
import { adminManifest } from './admin/index.js';
import { aiManifest } from './ai/index.js';
import { economyManifest } from './economy/index.js';
import { moderationManifest } from './moderation/index.js';
import { musicManifest } from './music/index.js';
import { utilityManifest } from './utility/index.js';

/**
 * Feature manifests (PLAN §3) — every feature exports its commands,
 * components, and autocomplete handlers here as explicit compile-time
 * imports.
 */
export interface FeatureManifest {
  readonly commands: readonly CommandModule[];
  readonly components: readonly ComponentModule[];
  readonly autocomplete: readonly AutocompleteModule[];
}

export const manifest: FeatureManifest = {
  commands: [
    ...utilityManifest.commands,
    ...economyManifest.commands,
    ...moderationManifest.commands,
    ...adminManifest.commands,
    ...musicManifest.commands,
    ...aiManifest.commands,
  ],
  components: [...economyManifest.components, ...musicManifest.components],
  autocomplete: [...economyManifest.autocomplete],
};

/** Build the application registry from the manifest. Throws on duplicates. */
export function buildRegistry(): Registry {
  const registry = createRegistry();
  for (const command of manifest.commands) registerCommand(registry, command);
  for (const component of manifest.components) registerComponent(registry, component);
  for (const handler of manifest.autocomplete) registerAutocomplete(registry, handler);
  return registry;
}

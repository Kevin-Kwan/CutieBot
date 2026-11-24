import type { AutocompleteModule, CommandModule, ComponentModule } from './contracts.js';

/**
 * Explicit manifest registry (PLAN §3) — compile-time imports aggregated per
 * feature in src/features/index.ts. No filesystem discovery.
 *
 * Duplicate names/keys throw immediately, so collisions fail at boot and in
 * tests instead of silently overwriting each other (the old bot registered
 * two different commands under the name `ping`).
 */
export class Registry {
  readonly commands = new Map<string, CommandModule>();
  readonly components = new Map<string, ComponentModule>();
  readonly autocomplete = new Map<string, AutocompleteModule>();

  /** Serialized application-command payload for the deploy script. */
  commandPayload(): unknown[] {
    return [...this.commands.values()].map((command) => command.data.toJSON());
  }
}

export function createRegistry(): Registry {
  return new Registry();
}

export function registerCommand(registry: Registry, command: CommandModule): void {
  const name = command.data.name;
  if (registry.commands.has(name)) {
    throw new Error(
      `Duplicate command registration: "${name}" is already registered; refusing to overwrite.`,
    );
  }
  registry.commands.set(name, command);
}

export function registerComponent(registry: Registry, component: ComponentModule): void {
  if (registry.components.has(component.key)) {
    throw new Error(
      `Duplicate component registration: "${component.key}" is already registered; refusing to overwrite.`,
    );
  }
  registry.components.set(component.key, component);
}

export function registerAutocomplete(registry: Registry, handler: AutocompleteModule): void {
  if (registry.autocomplete.has(handler.command)) {
    throw new Error(
      `Duplicate autocomplete registration for "${handler.command}"; refusing to overwrite.`,
    );
  }
  registry.autocomplete.set(handler.command, handler);
}

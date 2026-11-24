import { describe, expect, it } from 'vitest';
import type { CommandModule } from '../../src/core/contracts.js';
import {
  createRegistry,
  registerAutocomplete,
  registerCommand,
  registerComponent,
} from '../../src/core/registry.js';

function fakeCommand(name: string): CommandModule {
  return {
    data: { name, toJSON: () => ({ name, description: `${name} description` }) },
    execute: () => Promise.resolve(),
  };
}

describe('Registry', () => {
  it('registers and looks up a command by name', () => {
    const registry = createRegistry();
    const command = fakeCommand('ping');
    registerCommand(registry, command);
    expect(registry.commands.get('ping')).toBe(command);
    expect(registry.commands.size).toBe(1);
  });

  it('rejects a duplicate command name loudly', () => {
    const registry = createRegistry();
    registerCommand(registry, fakeCommand('ping'));
    expect(() => registerCommand(registry, fakeCommand('ping'))).toThrow(/Duplicate command/);
    expect(registry.commands.size).toBe(1);
  });

  it('rejects duplicate component keys and autocomplete handlers', () => {
    const registry = createRegistry();
    const component = { key: 'music:skip', execute: () => Promise.resolve() };
    registerComponent(registry, component);
    expect(() => registerComponent(registry, component)).toThrow(/Duplicate component/);

    const autocomplete = { command: 'play', execute: () => Promise.resolve() };
    registerAutocomplete(registry, autocomplete);
    expect(() => registerAutocomplete(registry, autocomplete)).toThrow(/Duplicate autocomplete/);
  });

  it('serializes the command payload from registered commands', () => {
    const registry = createRegistry();
    registerCommand(registry, fakeCommand('ping'));
    registerCommand(registry, fakeCommand('balance'));
    const payload = registry.commandPayload();
    expect(payload).toHaveLength(2);
    expect(payload).toContainEqual({ name: 'ping', description: 'ping description' });
  });
});

import { describe, expect, it } from 'vitest';
import { redactEntityFields, type RevealState } from './entityFieldReveal.js';

describe('redactEntityFields', () => {
  const row = {
    id: 1,
    name: 'Vale Lurker',
    armor_class: 15,
    damage_vulnerabilities: ['radiant'],
    damage_resistances: ['cold', 'fire'],
    damage_immunities: ['poison'],
  };

  it('unrevealed weakness fields become null, regardless of their true value', () => {
    const state = new Map<string, RevealState>([
      ['damage_vulnerabilities', { revealed: false, playerOverride: null }],
      ['damage_resistances', { revealed: false, playerOverride: null }],
      ['damage_immunities', { revealed: false, playerOverride: null }],
    ]);
    const result = redactEntityFields(row, state);
    expect(result.damage_vulnerabilities).toBeNull();
    expect(result.damage_resistances).toBeNull();
    expect(result.damage_immunities).toBeNull();
    // Fields outside the registry (id, name, armor_class) are never touched
    // — only the three weakness fields survived the hide/reveal removal.
    expect(result.id).toBe(1);
    expect(result.name).toBe('Vale Lurker');
    expect(result.armor_class).toBe(15);
  });

  it('revealed fields with no override pass the true value through untouched', () => {
    const state = new Map<string, RevealState>([['damage_resistances', { revealed: true, playerOverride: null }]]);
    const result = redactEntityFields(row, state);
    expect(result.damage_resistances).toEqual(['cold', 'fire']);
  });

  it('revealed fields with a playerOverride send the override, never the true value', () => {
    const state = new Map<string, RevealState>([
      ['damage_immunities', { revealed: true, playerOverride: 'Unknown to the party' }],
    ]);
    const result = redactEntityFields(row, state);
    expect(result.damage_immunities).toBe('Unknown to the party');
  });

  it('a field missing from the state map (a registry/resolveReveals bug) fails closed to hidden, not leaked', () => {
    const result = redactEntityFields(row, new Map());
    expect(result.damage_vulnerabilities).toBeNull();
    expect(result.damage_resistances).toBeNull();
    expect(result.damage_immunities).toBeNull();
  });
});

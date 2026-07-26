import { describe, expect, it } from 'vitest';
import { redactEntityFields, type RevealState } from './entityFieldReveal.js';

describe('redactEntityFields', () => {
  const row = {
    id: 1,
    name: 'Vale Lurker',
    armor_class: 15,
    speed: 30,
    senses: 'darkvision 60 ft.',
    languages: null,
    notes: 'Secretly a doppelganger',
  };

  it('unrevealed fields become null, regardless of their true value', () => {
    const state = new Map<string, RevealState>([
      ['armor_class', { revealed: false, playerOverride: null }],
      ['speed', { revealed: false, playerOverride: null }],
      ['senses', { revealed: false, playerOverride: null }],
      ['languages', { revealed: false, playerOverride: null }],
      ['notes', { revealed: false, playerOverride: null }],
    ]);
    const result = redactEntityFields(row, 'character', state);
    expect(result.armor_class).toBeNull();
    expect(result.speed).toBeNull();
    expect(result.senses).toBeNull();
    expect(result.notes).toBeNull();
    // Fields outside the registry (id, name) are never touched.
    expect(result.id).toBe(1);
    expect(result.name).toBe('Vale Lurker');
  });

  it('revealed fields with no override pass the true value through untouched', () => {
    const state = new Map<string, RevealState>([['armor_class', { revealed: true, playerOverride: null }]]);
    const result = redactEntityFields(row, 'character', state);
    expect(result.armor_class).toBe(15);
  });

  it('revealed fields with a playerOverride send the override, never the true value', () => {
    const state = new Map<string, RevealState>([['notes', { revealed: true, playerOverride: 'Something feels off about it' }]]);
    const result = redactEntityFields(row, 'character', state);
    expect(result.notes).toBe('Something feels off about it');
  });

  it('a field missing from the state map (a registry/resolveReveals bug) fails closed to hidden, not leaked', () => {
    const result = redactEntityFields(row, 'character', new Map());
    expect(result.armor_class).toBeNull();
    expect(result.notes).toBeNull();
  });

  it('uses the monster_instance registry (armor_class, traits, actions, ...) when asked, not the character one', () => {
    const monsterRow = { armor_class: 17, traits: [{ name: 'Pack Tactics' }], languages: 'Common' };
    const state = new Map<string, RevealState>([['armor_class', { revealed: true, playerOverride: null }]]);
    const result = redactEntityFields(monsterRow, 'monster_instance', state);
    expect(result.armor_class).toBe(17);
    expect(result.traits).toBeNull(); // registered field, unrevealed -> hidden
    // 'languages' isn't in MONSTER_INSTANCE_REVEALABLE_FIELDS (only in the
    // character list), so it's left completely untouched either way.
    expect(result.languages).toBe('Common');
  });
});

import { describe, expect, it } from 'vitest';
import { applyAbilityBonuses, combinedAbilityBonuses, parseAbilityBonuses } from './deriveAbilityBonuses';
import type { RaceCatalog, SubraceCatalog } from '../lib/types';

const baseScores = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };

function race(overrides: Partial<RaceCatalog>): RaceCatalog {
  return { id: 'race-1', index_key: 'elf', name: 'Elf', edition_scope: 'both', speed: 30, size: 'Medium', ability_bonuses: [], ...overrides };
}

function subrace(overrides: Partial<SubraceCatalog>): SubraceCatalog {
  return { id: 'subrace-1', race_id: 'race-1', index_key: 'high-elf', name: 'High Elf', ability_bonuses: [], ...overrides };
}

describe('parseAbilityBonuses', () => {
  it('parses the official SRD array shape', () => {
    const raw = [{ ability_score: { index: 'dex', name: 'DEX' }, bonus: 2 }];
    expect(parseAbilityBonuses(raw)).toEqual({ dex: 2 });
  });

  it('parses the homebrew flat-map shape', () => {
    expect(parseAbilityBonuses({ str: 1, dex: 2 })).toEqual({ str: 1, dex: 2 });
  });

  it('is uppercase-insensitive for the SRD index and homebrew keys', () => {
    expect(parseAbilityBonuses([{ ability_score: { index: 'DEX' }, bonus: 2 }])).toEqual({ dex: 2 });
    expect(parseAbilityBonuses({ DEX: 2 })).toEqual({ dex: 2 });
  });

  it('ignores unrecognized ability keys and malformed entries', () => {
    expect(parseAbilityBonuses({ notAnAbility: 5 })).toEqual({});
    expect(parseAbilityBonuses([{ bonus: 2 }])).toEqual({});
    expect(parseAbilityBonuses([{ ability_score: {}, bonus: 'two' }])).toEqual({});
  });

  it('returns an empty map for null/undefined', () => {
    expect(parseAbilityBonuses(null)).toEqual({});
    expect(parseAbilityBonuses(undefined)).toEqual({});
  });

  it('sums duplicate entries for the same ability rather than overwriting', () => {
    const raw = [
      { ability_score: { index: 'str' }, bonus: 1 },
      { ability_score: { index: 'str' }, bonus: 1 },
    ];
    expect(parseAbilityBonuses(raw)).toEqual({ str: 2 });
  });
});

describe('combinedAbilityBonuses', () => {
  it('stacks subrace bonuses on top of race bonuses', () => {
    const r = race({ ability_bonuses: [{ ability_score: { index: 'dex' }, bonus: 2 }] });
    const s = subrace({ ability_bonuses: { int: 1 } });
    expect(combinedAbilityBonuses(r, s)).toEqual({ dex: 2, int: 1 });
  });

  it('sums race and subrace bonuses on the SAME ability', () => {
    const r = race({ ability_bonuses: [{ ability_score: { index: 'dex' }, bonus: 2 }] });
    const s = subrace({ ability_bonuses: { dex: 1 } });
    expect(combinedAbilityBonuses(r, s)).toEqual({ dex: 3 });
  });

  it('handles no race and no subrace', () => {
    expect(combinedAbilityBonuses(null, null)).toEqual({});
  });
});

describe('applyAbilityBonuses', () => {
  it('applies combined bonuses on top of base rolled scores', () => {
    const r = race({ ability_bonuses: [{ ability_score: { index: 'dex' }, bonus: 2 }] });
    const s = subrace({ ability_bonuses: { int: 1 } });
    expect(applyAbilityBonuses(baseScores, r, s)).toEqual({ ...baseScores, dex: 12, int: 11 });
  });

  it('is a no-op with no race or subrace selected', () => {
    expect(applyAbilityBonuses(baseScores, null, null)).toEqual(baseScores);
  });
});

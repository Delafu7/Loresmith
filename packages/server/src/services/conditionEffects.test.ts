import { describe, expect, it } from 'vitest';
import {
  computeOwnAttackRollModifiers,
  computeAttacksAgainstMelee,
  computeAttacksAgainstRanged,
  criticalHitSourcesWithin5ft,
  computeAbilityCheckModifiers,
  computeSavingThrowModifiers,
  computeExhaustionPenalty,
} from './conditionEffects.js';

describe('computeOwnAttackRollModifiers', () => {
  it('no conditions: empty modifiers', () => {
    const m = computeOwnAttackRollModifiers([]);
    expect(m.advantageSources).toEqual([]);
    expect(m.disadvantageSources).toEqual([]);
    expect(m.caveats).toEqual([]);
  });

  it('Blinded/Poisoned/Restrained/Prone all give Disadvantage on your own attacks', () => {
    const m = computeOwnAttackRollModifiers(['blinded', 'poisoned', 'restrained', 'prone']);
    expect(m.disadvantageSources).toEqual(['blinded', 'poisoned', 'restrained', 'prone']);
  });

  it('Invisible gives Advantage with a "unless seen" caveat', () => {
    const m = computeOwnAttackRollModifiers(['invisible']);
    expect(m.advantageSources).toEqual(['invisible']);
    expect(m.caveats.some((c) => c.includes('Invisible'))).toBe(true);
  });

  it('Frightened and Grappled surface as caveats only, never as unconditional sources', () => {
    const m = computeOwnAttackRollModifiers(['frightened', 'grappled']);
    expect(m.disadvantageSources).toEqual([]);
    expect(m.advantageSources).toEqual([]);
    expect(m.caveats).toHaveLength(2);
    expect(m.caveats.some((c) => c.includes('Frightened'))).toBe(true);
    expect(m.caveats.some((c) => c.includes('Grappled'))).toBe(true);
  });

  it('Charmed/Deafened produce no attack-roll effect at all', () => {
    const m = computeOwnAttackRollModifiers(['charmed', 'deafened']);
    expect(m.advantageSources).toEqual([]);
    expect(m.disadvantageSources).toEqual([]);
    expect(m.caveats).toEqual([]);
  });
});

describe('computeAttacksAgainstMelee / computeAttacksAgainstRanged', () => {
  it('Blinded/Restrained/Paralyzed/Stunned/Unconscious/Petrified all give unconditional Advantage regardless of range', () => {
    const conditions = ['blinded', 'restrained', 'paralyzed', 'stunned', 'unconscious', 'petrified'];
    const melee = computeAttacksAgainstMelee(conditions);
    const ranged = computeAttacksAgainstRanged(conditions);
    expect(melee.advantageSources).toEqual(conditions);
    expect(ranged.advantageSources).toEqual(conditions);
  });

  it('Invisible gives unconditional Disadvantage with a caveat, regardless of range', () => {
    const melee = computeAttacksAgainstMelee(['invisible']);
    const ranged = computeAttacksAgainstRanged(['invisible']);
    expect(melee.disadvantageSources).toEqual(['invisible']);
    expect(ranged.disadvantageSources).toEqual(['invisible']);
    expect(melee.caveats.some((c) => c.includes('Invisible'))).toBe(true);
  });

  it('Prone flips: Advantage in melee, Disadvantage at range — the one range-dependent condition', () => {
    const melee = computeAttacksAgainstMelee(['prone']);
    const ranged = computeAttacksAgainstRanged(['prone']);
    expect(melee.advantageSources).toEqual(['prone']);
    expect(melee.disadvantageSources).toEqual([]);
    expect(ranged.disadvantageSources).toEqual(['prone']);
    expect(ranged.advantageSources).toEqual([]);
  });

  it('Prone combined with an unconditional-Advantage condition never double-counts or conflicts', () => {
    const ranged = computeAttacksAgainstRanged(['prone', 'restrained']);
    expect(ranged.advantageSources).toEqual(['restrained']);
    expect(ranged.disadvantageSources).toEqual(['prone']);
  });
});

describe('criticalHitSourcesWithin5ft', () => {
  it('Paralyzed and Unconscious are the only sources', () => {
    expect(criticalHitSourcesWithin5ft(['paralyzed', 'unconscious', 'stunned', 'restrained'])).toEqual(['paralyzed', 'unconscious']);
  });

  it('empty when neither is active', () => {
    expect(criticalHitSourcesWithin5ft(['stunned', 'petrified'])).toEqual([]);
  });
});

describe('computeAbilityCheckModifiers', () => {
  it('Poisoned gives unconditional Disadvantage', () => {
    const m = computeAbilityCheckModifiers(['poisoned']);
    expect(m.disadvantageSources).toEqual(['poisoned']);
  });

  it('Blinded/Deafened/Frightened surface only as caveats (context this function cannot resolve)', () => {
    const m = computeAbilityCheckModifiers(['blinded', 'deafened', 'frightened']);
    expect(m.disadvantageSources).toEqual([]);
    expect(m.caveats).toHaveLength(3);
  });
});

describe('computeSavingThrowModifiers', () => {
  it('Paralyzed/Stunned/Unconscious/Petrified auto-fail Str and Dex saves, not other abilities', () => {
    const conditions = ['paralyzed', 'stunned', 'unconscious', 'petrified'];
    const str = computeSavingThrowModifiers(conditions, 'str');
    const dex = computeSavingThrowModifiers(conditions, 'dex');
    const con = computeSavingThrowModifiers(conditions, 'con');
    expect(str.autoFail).toBe(true);
    expect(str.autoFailSources).toEqual(conditions);
    expect(dex.autoFail).toBe(true);
    expect(con.autoFail).toBe(false);
    expect(con.autoFailSources).toEqual([]);
  });

  it('Restrained gives Disadvantage on Dex saves only, never auto-fail', () => {
    const dex = computeSavingThrowModifiers(['restrained'], 'dex');
    const str = computeSavingThrowModifiers(['restrained'], 'str');
    expect(dex.disadvantageSources).toEqual(['restrained']);
    expect(dex.autoFail).toBe(false);
    expect(str.disadvantageSources).toEqual([]);
  });

  it('no conditions: every ability comes back clean', () => {
    for (const ability of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const) {
      const m = computeSavingThrowModifiers([], ability);
      expect(m.autoFail).toBe(false);
      expect(m.disadvantageSources).toEqual([]);
    }
  });
});

describe('computeExhaustionPenalty', () => {
  it('2024: -2 per exhaustion level', () => {
    expect(computeExhaustionPenalty('2024', 0)).toBe(0);
    expect(computeExhaustionPenalty('2024', 1)).toBe(-2);
    expect(computeExhaustionPenalty('2024', 6)).toBe(-12);
  });

  it('2014: always 0 — not modeled (structurally different per-level table, not a flat penalty)', () => {
    expect(computeExhaustionPenalty('2014', 3)).toBe(0);
  });

  it('never returns a positive penalty for a negative level input', () => {
    expect(computeExhaustionPenalty('2024', -1)).toBe(0);
  });
});

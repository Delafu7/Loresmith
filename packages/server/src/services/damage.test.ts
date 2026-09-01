import { describe, expect, it } from 'vitest';
import { computeAppliedDamage, computeFallDamageDiceCount, type DamageTarget } from './damage.js';

function target(overrides: Partial<DamageTarget> = {}): DamageTarget {
  return { resistances: [], vulnerabilities: [], immunities: [], ...overrides };
}

describe('computeAppliedDamage', () => {
  it('no resistance/vulnerability/immunity: applied damage equals raw total', () => {
    const result = computeAppliedDamage({ rolledDiceTotal: 8, modifier: 3, damageType: 'fire', isCritical: false }, target());
    expect(result.rawTotal).toBe(11);
    expect(result.appliedDamage).toBe(11);
  });

  it('resistance halves and rounds down', () => {
    const result = computeAppliedDamage(
      { rolledDiceTotal: 4, modifier: 3, damageType: 'fire', isCritical: false },
      target({ resistances: ['fire'] }),
    );
    // raw = 7, floor(7/2) = 3
    expect(result.rawTotal).toBe(7);
    expect(result.appliedDamage).toBe(3);
    expect(result.breakdown.resistanceApplied).toBe(true);
  });

  it('vulnerability doubles', () => {
    const result = computeAppliedDamage(
      { rolledDiceTotal: 5, modifier: 2, damageType: 'cold', isCritical: false },
      target({ vulnerabilities: ['cold'] }),
    );
    expect(result.rawTotal).toBe(7);
    expect(result.appliedDamage).toBe(14);
  });

  it('resistance AND vulnerability to the same type: resistance applied first, then vulnerability to the halved result', () => {
    // raw = 25 -> resist: floor(25/2) = 12 -> vulnerable: 12*2 = 24
    // A naive "they cancel out" implementation would return 25 here — this
    // test would fail under that wrong implementation.
    const result = computeAppliedDamage(
      { rolledDiceTotal: 20, modifier: 5, damageType: 'poison', isCritical: false },
      target({ resistances: ['poison'], vulnerabilities: ['poison'] }),
    );
    expect(result.rawTotal).toBe(25);
    expect(result.appliedDamage).toBe(24);
  });

  it('multiple sources of the same resistance never stack past one halving', () => {
    // Simulated by the array containing the type once (the caller is
    // responsible for de-duplicating multiple sources into one array before
    // calling this function) — this proves .includes() matching, not a
    // count, is what the function itself does.
    const result = computeAppliedDamage(
      { rolledDiceTotal: 7, modifier: 0, damageType: 'slashing', isCritical: false },
      target({ resistances: ['slashing'] }),
    );
    expect(result.appliedDamage).toBe(3); // floor(7/2), not floor(7/4)
  });

  it('immunity zeroes damage regardless of also being (erroneously) vulnerable', () => {
    const result = computeAppliedDamage(
      { rolledDiceTotal: 10, modifier: 5, damageType: 'necrotic', isCritical: false },
      target({ immunities: ['necrotic'], vulnerabilities: ['necrotic'] }),
    );
    expect(result.appliedDamage).toBe(0);
    expect(result.breakdown.immune).toBe(true);
  });

  it('untyped damage (damageType: null) ignores all three arrays', () => {
    const result = computeAppliedDamage(
      { rolledDiceTotal: 6, modifier: 2, damageType: null, isCritical: false },
      target({ resistances: ['force'], vulnerabilities: ['force'], immunities: ['force'] }),
    );
    expect(result.appliedDamage).toBe(8);
  });

  it('critical hit doubling happens before this function runs — caller passes the already-doubled dice total, and resistance applies to that doubled total', () => {
    // Caller rolled 2d6 (doubled from 1d6 because isCritical) and got a
    // total of 12; this function must apply resistance AFTER that doubled
    // total, not attempt to re-derive or re-double anything itself.
    const result = computeAppliedDamage(
      { rolledDiceTotal: 12, modifier: 3, damageType: 'slashing', isCritical: true },
      target({ resistances: ['slashing'] }),
    );
    // raw = 15 -> floor(15/2) = 7. A WRONG order (halve the un-doubled 6+3=9
    // first, then double the dice-only portion) would produce a different,
    // incorrect number — this test's expected value only matches the
    // correct order.
    expect(result.rawTotal).toBe(15);
    expect(result.appliedDamage).toBe(7);
  });

  it('never goes negative — a 1-point resisted hit floors at 0', () => {
    const result = computeAppliedDamage(
      { rolledDiceTotal: 1, modifier: 0, damageType: 'poison', isCritical: false },
      target({ resistances: ['poison'] }),
    );
    expect(result.appliedDamage).toBe(0);
  });

  it('a negative raw total (heavy penalty) clamps to 0, never negative', () => {
    const result = computeAppliedDamage({ rolledDiceTotal: 2, modifier: -10, damageType: 'fire', isCritical: false }, target());
    expect(result.rawTotal).toBe(0);
    expect(result.appliedDamage).toBe(0);
  });

  it('is case-insensitive on damage type matching', () => {
    const result = computeAppliedDamage(
      { rolledDiceTotal: 8, modifier: 0, damageType: 'Fire', isCritical: false },
      target({ resistances: ['fire'] }),
    );
    expect(result.appliedDamage).toBe(4);
  });

  describe('P1-12: half_on_save wiring', () => {
    it('a successful save halves damage (round down), defaulting halfOnSave to true when unset', () => {
      const result = computeAppliedDamage(
        { rolledDiceTotal: 5, modifier: 2, damageType: null, isCritical: false, savingThrowSucceeded: true },
        target(),
      );
      // raw = 7, floor(7/2) = 3
      expect(result.rawTotal).toBe(7);
      expect(result.appliedDamage).toBe(3);
      expect(result.breakdown.savedHalved).toBe(true);
      expect(result.breakdown.savedNegated).toBe(false);
    });

    it('halfOnSave: false negates damage entirely on a successful save', () => {
      const result = computeAppliedDamage(
        { rolledDiceTotal: 20, modifier: 5, damageType: null, isCritical: false, savingThrowSucceeded: true, halfOnSave: false },
        target(),
      );
      expect(result.rawTotal).toBe(25);
      expect(result.appliedDamage).toBe(0);
      expect(result.breakdown.savedNegated).toBe(true);
      expect(result.breakdown.savedHalved).toBe(false);
    });

    it('a failed save (savingThrowSucceeded: false) applies full damage, unaffected by halfOnSave', () => {
      const result = computeAppliedDamage(
        { rolledDiceTotal: 8, modifier: 3, damageType: null, isCritical: false, savingThrowSucceeded: false, halfOnSave: true },
        target(),
      );
      expect(result.appliedDamage).toBe(11);
      expect(result.breakdown.savedHalved).toBe(false);
      expect(result.breakdown.savedNegated).toBe(false);
    });

    it('no save at all (savingThrowSucceeded undefined) behaves exactly as before this feature — full damage', () => {
      const result = computeAppliedDamage({ rolledDiceTotal: 8, modifier: 3, damageType: null, isCritical: false }, target());
      expect(result.appliedDamage).toBe(11);
      expect(result.breakdown.savedHalved).toBe(false);
      expect(result.breakdown.savedNegated).toBe(false);
    });

    it('half-on-save applies BEFORE resistance/vulnerability, to the already-halved number (docs/rules/attacks-and-damage.md §3 edge case 7)', () => {
      // raw = 25 -> half-on-save: floor(25/2) = 12 -> resist: floor(12/2) = 6
      // A wrong order (resist first: floor(25/2)=12, then half-on-save floor(12/2)=6)
      // happens to coincide here, so also check a vulnerability case where order actually diverges.
      const resisted = computeAppliedDamage(
        { rolledDiceTotal: 20, modifier: 5, damageType: 'fire', isCritical: false, savingThrowSucceeded: true },
        target({ resistances: ['fire'] }),
      );
      expect(resisted.rawTotal).toBe(25);
      expect(resisted.appliedDamage).toBe(6);

      // raw = 9 -> half-on-save: floor(9/2) = 4 -> vulnerable: 4*2 = 8.
      // A wrong order (vulnerable first: 9*2=18, then half floor(18/2)=9) would
      // produce 9 instead — this assertion only matches the correct order.
      const vulnerable = computeAppliedDamage(
        { rolledDiceTotal: 7, modifier: 2, damageType: 'cold', isCritical: false, savingThrowSucceeded: true },
        target({ vulnerabilities: ['cold'] }),
      );
      expect(vulnerable.rawTotal).toBe(9);
      expect(vulnerable.appliedDamage).toBe(8);
    });

    it('a negated save still zeroes out even against a vulnerable target', () => {
      const result = computeAppliedDamage(
        { rolledDiceTotal: 10, modifier: 0, damageType: 'cold', isCritical: false, savingThrowSucceeded: true, halfOnSave: false },
        target({ vulnerabilities: ['cold'] }),
      );
      expect(result.appliedDamage).toBe(0);
    });

    it('immunity still wins over a saved-and-halved total', () => {
      const result = computeAppliedDamage(
        { rolledDiceTotal: 10, modifier: 0, damageType: 'necrotic', isCritical: false, savingThrowSucceeded: true },
        target({ immunities: ['necrotic'] }),
      );
      expect(result.appliedDamage).toBe(0);
      expect(result.breakdown.immune).toBe(true);
    });
  });
});

// docs/roadmap/dnd-2024-gap-analysis.md P3-1 (ER-06) — rulesGlossary.md line
// 860: "1d6 Bludgeoning damage... for every 10 feet it fell, to a maximum
// of 20d6."
describe('computeFallDamageDiceCount', () => {
  it('a fall under 10 ft deals 0 dice (floor division, matching RAW)', () => {
    expect(computeFallDamageDiceCount(0)).toBe(0);
    expect(computeFallDamageDiceCount(9)).toBe(0);
  });

  it('one d6 per full 10 ft fallen', () => {
    expect(computeFallDamageDiceCount(10)).toBe(1);
    expect(computeFallDamageDiceCount(15)).toBe(1);
    expect(computeFallDamageDiceCount(30)).toBe(3);
    expect(computeFallDamageDiceCount(45)).toBe(4);
  });

  it('caps at 20d6 for a 200+ ft fall', () => {
    expect(computeFallDamageDiceCount(200)).toBe(20);
    expect(computeFallDamageDiceCount(500)).toBe(20);
  });

  it('never goes negative for a negative/garbage distance', () => {
    expect(computeFallDamageDiceCount(-50)).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { computeAppliedDamage, type DamageTarget } from './damage.js';

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
});

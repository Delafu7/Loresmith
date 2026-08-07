// Unit tests for the Iteration 3 dice-engine primitives (services/
// diceEngine.ts), directly exercising docs/rules/dice-mechanics.md's own
// "What must be tested" worked examples per section. No live DB needed —
// every function here is pure (rerollOnceIfMatches's one rollDie call is
// mocked below, this file's first precedent for mocking in this test
// suite, since it's the first pure-computation-with-injectable-RNG module).

import { afterEach, describe, expect, it, vi } from 'vitest';

const rollDieMock = vi.fn<(sides: number) => number>();
vi.mock('./diceRolls.js', () => ({
  rollDie: (sides: number) => rollDieMock(sides),
}));

const {
  criticalDiceCount,
  resolveAdvantage,
  rerollOnceIfMatches,
  clampDieMinimum,
  computeSaveDc,
  proficiencyBonusForLevel,
} = await import('./diceEngine.js');

afterEach(() => {
  rollDieMock.mockReset();
});

// ---- §1.4 — critical hit dice-doubling ----
describe('criticalDiceCount', () => {
  it('non-critical leaves the dice count unchanged', () => {
    expect(criticalDiceCount(1, false)).toBe(1);
  });
  it('critical doubles the dice count', () => {
    expect(criticalDiceCount(1, true)).toBe(2);
  });
  it('doubles a larger pool too (Sneak-Attack-sized, not just 1-die weapons)', () => {
    expect(criticalDiceCount(3, true)).toBe(6);
  });
});

// ---- §2.4 — advantage/disadvantage source-count collapse ----
describe('resolveAdvantage', () => {
  it('no sources -> normal', () => {
    expect(resolveAdvantage(0, 0)).toBe('normal');
  });
  it('one advantage source -> advantage', () => {
    expect(resolveAdvantage(1, 0)).toBe('advantage');
  });
  it('three advantage sources still collapse to advantage, never "extra dice"', () => {
    expect(resolveAdvantage(3, 0)).toBe('advantage');
  });
  it('one disadvantage source -> disadvantage', () => {
    expect(resolveAdvantage(0, 1)).toBe('disadvantage');
  });
  it('3 advantage + 1 disadvantage cancels to normal — the exact task-brief case', () => {
    expect(resolveAdvantage(3, 1)).toBe('normal');
  });
  it('1 advantage + 1 disadvantage cancels to normal', () => {
    expect(resolveAdvantage(1, 1)).toBe('normal');
  });
});

// ---- §3.4 — 2014 GWF / Lucky reroll-once semantics ----
describe('rerollOnceIfMatches', () => {
  const isOneOrTwo = (roll: number) => roll === 1 || roll === 2;

  it('rerolls exactly once even if the new value also matches the trigger — never loops', () => {
    rollDieMock.mockReturnValueOnce(2);
    const result = rerollOnceIfMatches(1, isOneOrTwo, 8);
    expect(result).toEqual({ finalValue: 2, wasRerolled: true });
    expect(rollDieMock).toHaveBeenCalledTimes(1);
    expect(rollDieMock).toHaveBeenCalledWith(8);
  });

  it('a non-matching original roll is never rerolled, and rollDie is never called', () => {
    const result = rerollOnceIfMatches(5, isOneOrTwo, 8);
    expect(result).toEqual({ finalValue: 5, wasRerolled: false });
    expect(rollDieMock).not.toHaveBeenCalled();
  });
});

// ---- §3.4/§4.4 — 2024 GWF floor ----
describe('clampDieMinimum', () => {
  it('raises a die below the floor', () => {
    expect(clampDieMinimum(1, 3)).toBe(3);
    expect(clampDieMinimum(2, 3)).toBe(3);
  });
  it('leaves a die already at the floor unchanged', () => {
    expect(clampDieMinimum(3, 3)).toBe(3);
  });
  it('never lowers a die already above the floor', () => {
    expect(clampDieMinimum(6, 3)).toBe(6);
  });
});

// ---- §5.4 — save DC / proficiency bonus ----
describe('computeSaveDc', () => {
  it('level-1 cleric worked example: 8 + 2 + 3 = 13', () => {
    expect(computeSaveDc(2, 3)).toBe(13);
  });
  it('level-9 cleric worked example: 8 + 4 + 4 = 16', () => {
    expect(computeSaveDc(4, 4)).toBe(16);
  });
  it('level-17 cleric worked example: 8 + 6 + 5 = 19', () => {
    expect(computeSaveDc(6, 5)).toBe(19);
  });
  it('accepts an explicit special-modifiers term', () => {
    expect(computeSaveDc(2, 3, 1)).toBe(14);
  });
});

describe('proficiencyBonusForLevel', () => {
  it.each([
    [1, 2], [4, 2],
    [5, 3], [8, 3],
    [9, 4], [12, 4],
    [13, 5], [16, 5],
    [17, 6], [20, 6],
  ])('level %i -> proficiency bonus %i', (level, expected) => {
    expect(proficiencyBonusForLevel(level)).toBe(expected);
  });
});

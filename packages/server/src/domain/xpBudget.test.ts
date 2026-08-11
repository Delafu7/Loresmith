import { describe, expect, it } from 'vitest';
import { assessEncounterXp } from './xpBudget.js';

describe('assessEncounterXp — 2014', () => {
  it('throws for an empty party', () => {
    expect(() => assessEncounterXp('2014', [], [])).toThrow();
  });

  it('resolves an empty monster list to trivial', () => {
    const result = assessEncounterXp('2014', [3], []);
    expect(result.tier).toBe('trivial');
  });

  it('looks up level 1 and level 20 thresholds correctly', () => {
    const l1 = assessEncounterXp('2014', [1], []);
    if (l1.edition !== '2014') throw new Error('expected 2014');
    expect(l1.partyThresholds).toEqual({ easy: 25, medium: 50, hard: 75, deadly: 100 });

    const l20 = assessEncounterXp('2014', [20], []);
    if (l20.edition !== '2014') throw new Error('expected 2014');
    expect(l20.partyThresholds).toEqual({ easy: 2800, medium: 5700, hard: 8500, deadly: 12700 });
  });

  it('sums per-character thresholds for a mixed-level party (source worked example)', () => {
    const result = assessEncounterXp('2014', [3, 3, 3, 2], []);
    if (result.edition !== '2014') throw new Error('expected 2014');
    expect(result.partyThresholds).toEqual({ easy: 275, medium: 550, hard: 825, deadly: 1400 });
  });

  it.each([
    [1, 1],
    [2, 1.5],
    [3, 2],
    [6, 2],
    [7, 2.5],
    [10, 2.5],
    [11, 3],
    [14, 3],
    [15, 4],
    [16, 4],
  ])('applies the unshifted multiplier for %i monsters against a 3-5 character party', (count, expectedMultiplier) => {
    const monsters = [{ xpValue: 10, quantity: count }];
    const result = assessEncounterXp('2014', [1, 1, 1, 1], monsters); // party of 4, no shift
    if (result.edition !== '2014') throw new Error('expected 2014');
    expect(result.multiplier).toBe(expectedMultiplier);
  });

  it('shifts to the next-highest multiplier column for a party smaller than 3', () => {
    const result = assessEncounterXp('2014', [1, 1], [{ xpValue: 10, quantity: 1 }]);
    if (result.edition !== '2014') throw new Error('expected 2014');
    expect(result.multiplier).toBe(1.5); // single monster, base x1 shifted up one column
  });

  it('extends the multiplier table past x4 for a small party against 15+ monsters', () => {
    const result = assessEncounterXp('2014', [1, 1], [{ xpValue: 10, quantity: 15 }]);
    if (result.edition !== '2014') throw new Error('expected 2014');
    expect(result.multiplier).toBe(5);
  });

  it('shifts to the next-lowest multiplier column for a party of 6 or more', () => {
    const result = assessEncounterXp('2014', [1, 1, 1, 1, 1, 1], [{ xpValue: 10, quantity: 1 }]);
    if (result.edition !== '2014') throw new Error('expected 2014');
    expect(result.multiplier).toBe(0.5);
  });

  it('excludes zero-quantity monster rows from the sum and the multiplier count', () => {
    const result = assessEncounterXp('2014', [1, 1, 1, 1], [
      { xpValue: 100, quantity: 2 },
      { xpValue: 500, quantity: 0 },
    ]);
    if (result.edition !== '2014') throw new Error('expected 2014');
    expect(result.monsterCount).toBe(2);
    expect(result.rawMonsterXp).toBe(200);
  });

  it('classifies the source\'s worked encounter (1 bugbear + 3 hobgoblins) as hard', () => {
    // Raw monster XP of 500 across 4 monsters vs. a 3xL3+1xL2 party (no
    // shift, x2 multiplier) -> adjusted 1000, which lands between the
    // party's Hard (825) and Deadly (1400) thresholds.
    const result = assessEncounterXp('2014', [3, 3, 3, 2], [{ xpValue: 125, quantity: 4 }]);
    if (result.edition !== '2014') throw new Error('expected 2014');
    expect(result.adjustedMonsterXp).toBe(1000);
    expect(result.tier).toBe('hard');
  });
});

describe('assessEncounterXp — 2024', () => {
  it('throws for an empty party', () => {
    expect(() => assessEncounterXp('2024', [], [])).toThrow();
  });

  it('resolves an empty monster list to trivial', () => {
    const result = assessEncounterXp('2024', [3], []);
    expect(result.tier).toBe('trivial');
  });

  it('matches the source worked example: 4x level-1 at Low = 200 XP budget', () => {
    const result = assessEncounterXp('2024', [1, 1, 1, 1], []);
    if (result.edition !== '2024') throw new Error('expected 2024');
    expect(result.partyBudgets.low).toBe(200);
  });

  it('matches the source worked example: 5x level-3 at Moderate = 1125 XP budget', () => {
    const result = assessEncounterXp('2024', [3, 3, 3, 3, 3], []);
    if (result.edition !== '2024') throw new Error('expected 2024');
    expect(result.partyBudgets.moderate).toBe(1125);
  });

  it('matches the source worked example: 6x level-15 at High = 46800 XP budget', () => {
    const result = assessEncounterXp('2024', [15, 15, 15, 15, 15, 15], []);
    if (result.edition !== '2024') throw new Error('expected 2024');
    expect(result.partyBudgets.high).toBe(46800);
  });

  it('degenerates to the single-level-party math when all levels are equal', () => {
    const uniform = assessEncounterXp('2024', [5, 5, 5], []);
    if (uniform.edition !== '2024') throw new Error('expected 2024');
    expect(uniform.partyBudgets).toEqual({ low: 1500, moderate: 2250, high: 3300 });
  });

  it('sums each character\'s own row for a mixed-level party (interpretive choice)', () => {
    const result = assessEncounterXp('2024', [1, 2], []);
    if (result.edition !== '2024') throw new Error('expected 2024');
    // level 1: {50,75,100} + level 2: {100,150,200}
    expect(result.partyBudgets).toEqual({ low: 150, moderate: 225, high: 300 });
  });

  it('never applies a monster-count multiplier — pure sum of xpValue * quantity', () => {
    const manyWeak = assessEncounterXp('2024', [5, 5, 5, 5], [{ xpValue: 20, quantity: 15 }]);
    const oneStrong = assessEncounterXp('2024', [5, 5, 5, 5], [{ xpValue: 300, quantity: 1 }]);
    if (manyWeak.edition !== '2024' || oneStrong.edition !== '2024') throw new Error('expected 2024');
    expect(manyWeak.monsterXpTotal).toBe(300);
    expect(oneStrong.monsterXpTotal).toBe(300);
    expect(manyWeak.tier).toBe(oneStrong.tier);
  });

  it('excludes zero-quantity monster rows from the sum', () => {
    const result = assessEncounterXp('2024', [4], [
      { xpValue: 100, quantity: 1 },
      { xpValue: 999, quantity: 0 },
    ]);
    if (result.edition !== '2024') throw new Error('expected 2024');
    expect(result.monsterXpTotal).toBe(100);
  });
});

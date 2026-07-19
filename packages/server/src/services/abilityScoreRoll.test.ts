import { describe, expect, it } from 'vitest';
import { dropLowestOfFour, rollAbilityScoreSet, rollAbilityScores } from './abilityScoreRoll.js';

describe('dropLowestOfFour', () => {
  it('drops the single lowest die and sums the rest', () => {
    const result = dropLowestOfFour([6, 5, 1, 4]);
    expect(result.droppedIndex).toBe(2);
    expect(result.total).toBe(15);
    expect(result.dice).toEqual([6, 5, 1, 4]);
  });

  it('drops the FIRST occurrence when the lowest value is tied', () => {
    const result = dropLowestOfFour([3, 3, 6, 6]);
    expect(result.droppedIndex).toBe(0);
    expect(result.total).toBe(15);
  });

  it('handles all-equal dice', () => {
    const result = dropLowestOfFour([4, 4, 4, 4]);
    expect(result.droppedIndex).toBe(0);
    expect(result.total).toBe(12);
  });
});

describe('rollAbilityScoreSet', () => {
  it('always produces 4 dice between 1 and 6 and a total consistent with dropping the lowest', () => {
    for (let i = 0; i < 50; i++) {
      const set = rollAbilityScoreSet();
      expect(set.dice).toHaveLength(4);
      for (const d of set.dice) {
        expect(d).toBeGreaterThanOrEqual(1);
        expect(d).toBeLessThanOrEqual(6);
      }
      const expectedTotal = set.dice.reduce((sum, d, idx) => (idx === set.droppedIndex ? sum : sum + d), 0);
      expect(set.total).toBe(expectedTotal);
      expect(set.total).toBeGreaterThanOrEqual(3);
      expect(set.total).toBeLessThanOrEqual(18);
    }
  });
});

describe('rollAbilityScores', () => {
  it('produces exactly 6 independent sets', () => {
    const sets = rollAbilityScores();
    expect(sets).toHaveLength(6);
  });
});

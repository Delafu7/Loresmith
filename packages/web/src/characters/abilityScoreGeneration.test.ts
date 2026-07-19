import { describe, expect, it } from 'vitest';
import { pointBuyTotalCost, POINT_BUY_BUDGET, STANDARD_ARRAY } from './abilityScoreGeneration';

describe('STANDARD_ARRAY', () => {
  it('is the 5e PHB standard array', () => {
    expect(STANDARD_ARRAY).toEqual([15, 14, 13, 12, 10, 8]);
  });
});

describe('pointBuyTotalCost', () => {
  it('an all-8 baseline costs 0 points', () => {
    expect(pointBuyTotalCost({ str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 })).toBe(0);
  });

  it('a typical spread costs within the standard 27-point budget', () => {
    // 15,14,13,12,10,8 -> 9+7+5+4+2+0 = 27, exactly the standard budget
    const cost = pointBuyTotalCost({ str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 });
    expect(cost).toBe(27);
    expect(cost).toBe(POINT_BUY_BUDGET);
  });

  it('maxing every ability out at 15 costs more than the budget', () => {
    const cost = pointBuyTotalCost({ str: 15, dex: 15, con: 15, int: 15, wis: 15, cha: 15 });
    expect(cost).toBe(54);
    expect(cost).toBeGreaterThan(POINT_BUY_BUDGET);
  });
});

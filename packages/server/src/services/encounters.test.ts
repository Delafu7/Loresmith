import { describe, expect, it } from 'vitest';
import { computeNextTurn, dexModifier } from './encounters.js';

describe('dexModifier', () => {
  it.each([
    [1, -5],
    [8, -1],
    [9, -1],
    [10, 0],
    [11, 0],
    [12, 1],
    [14, 2],
    [15, 2],
    [16, 3],
    [20, 5],
  ])('DEX %i -> modifier %i', (score, expected) => {
    expect(dexModifier(score)).toBe(expected);
  });
});

describe('computeNextTurn', () => {
  it('advances the turn index without changing the round mid-encounter', () => {
    expect(computeNextTurn(0, 1, 5)).toEqual({ nextIndex: 1, nextRound: 1 });
    expect(computeNextTurn(3, 1, 5)).toEqual({ nextIndex: 4, nextRound: 1 });
  });

  it('wraps to index 0 and increments the round only when advancing past the last participant', () => {
    expect(computeNextTurn(4, 1, 5)).toEqual({ nextIndex: 0, nextRound: 2 });
  });

  it('wraps every advance for a single-participant encounter', () => {
    expect(computeNextTurn(0, 1, 1)).toEqual({ nextIndex: 0, nextRound: 2 });
    expect(computeNextTurn(0, 2, 1)).toEqual({ nextIndex: 0, nextRound: 3 });
  });
});

import { describe, expect, it } from 'vitest';
import { computeNextTurn, dexModifier, requireCurrentTurn } from './encounters.js';

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

describe('requireCurrentTurn', () => {
  it.each(['preparing', 'paused', 'completed'] as const)(
    'never throws while the encounter is %s, regardless of turn order',
    (status) => {
      expect(() =>
        requireCurrentTurn({ status, current_turn_index: 2 }, { turn_order: 0 }),
      ).not.toThrow();
    },
  );

  it('does not throw when it is the active encounter’s current turn', () => {
    expect(() =>
      requireCurrentTurn({ status: 'active', current_turn_index: 2 }, { turn_order: 2 }),
    ).not.toThrow();
  });

  it('throws NOT_YOUR_TURN when the encounter is active and turn order does not match', () => {
    let caught: unknown;
    try {
      requireCurrentTurn({ status: 'active', current_turn_index: 2 }, { turn_order: 0 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toMatchObject({ code: 'CONFLICT', details: { reason: 'NOT_YOUR_TURN' } });
  });
});

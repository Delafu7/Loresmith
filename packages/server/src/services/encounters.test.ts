import { describe, expect, it } from 'vitest';
import { computeNextTurn, computePreviousTurn, dexModifier, requireCurrentTurn } from './encounters.js';

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
  it('advances to the next turn_order without changing the round mid-encounter', () => {
    expect(computeNextTurn([0, 1, 2, 3, 4], 0, 1)).toEqual({ nextTurnOrder: 1, nextRound: 1 });
    expect(computeNextTurn([0, 1, 2, 3, 4], 3, 1)).toEqual({ nextTurnOrder: 4, nextRound: 1 });
  });

  it('wraps to the lowest turn_order and increments the round only when advancing past the last participant', () => {
    expect(computeNextTurn([0, 1, 2, 3, 4], 4, 1)).toEqual({ nextTurnOrder: 0, nextRound: 2 });
  });

  it('wraps every advance for a single-participant encounter', () => {
    expect(computeNextTurn([0], 0, 1)).toEqual({ nextTurnOrder: 0, nextRound: 2 });
    expect(computeNextTurn([0], 0, 2)).toEqual({ nextTurnOrder: 0, nextRound: 3 });
  });

  it('is immune to gaps in turn_order — a removed participant leaves a hole that must be skipped, not blocked on', () => {
    // Participant at turn_order 2 was removed mid-combat; 1 -> 3 must work
    // even though 2 no longer exists.
    expect(computeNextTurn([0, 1, 3, 4], 1, 1)).toEqual({ nextTurnOrder: 3, nextRound: 1 });
  });

  it('resolves a currentTurnOrder that no longer exists in the list (the active combatant was just removed) to whoever is next by value', () => {
    expect(computeNextTurn([0, 1, 3], 2, 1)).toEqual({ nextTurnOrder: 3, nextRound: 1 });
  });

  it('wraps and increments the round when the just-removed active combatant was last in order', () => {
    expect(computeNextTurn([0, 1, 3], 5, 1)).toEqual({ nextTurnOrder: 0, nextRound: 2 });
  });
});

describe('computePreviousTurn', () => {
  it('steps back to the previous turn_order without changing the round mid-encounter', () => {
    expect(computePreviousTurn([0, 1, 2, 3, 4], 4, 1)).toEqual({ previousTurnOrder: 3, previousRound: 1 });
    expect(computePreviousTurn([0, 1, 2, 3, 4], 1, 1)).toEqual({ previousTurnOrder: 0, previousRound: 1 });
  });

  it('wraps to the highest turn_order and decrements the round when stepping back past the first participant', () => {
    expect(computePreviousTurn([0, 1, 2, 3, 4], 0, 2)).toEqual({ previousTurnOrder: 4, previousRound: 1 });
  });

  it('returns null when already at the first turn of round 1 — nowhere left to step back to', () => {
    expect(computePreviousTurn([0, 1, 2, 3, 4], 0, 1)).toBeNull();
    expect(computePreviousTurn([0], 0, 1)).toBeNull();
  });

  it('is immune to gaps in turn_order — a removed participant leaves a hole that must be skipped, not blocked on', () => {
    expect(computePreviousTurn([0, 1, 3, 4], 3, 1)).toEqual({ previousTurnOrder: 1, previousRound: 1 });
  });

  it('resolves a currentTurnOrder that no longer exists in the list to whoever is previous by value', () => {
    expect(computePreviousTurn([0, 1, 3], 2, 1)).toEqual({ previousTurnOrder: 1, previousRound: 1 });
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

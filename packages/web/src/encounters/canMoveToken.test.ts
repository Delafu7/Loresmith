import { describe, expect, it } from 'vitest';
import { canMoveToken } from './canMoveToken';

describe('canMoveToken', () => {
  it('the DM can always move any token, in any mode/status/turn', () => {
    expect(
      canMoveToken({ mode: 'combat', status: 'active', currentTurnIndex: 3 }, { turnOrder: 0 }, false, true),
    ).toBe(true);
    expect(
      canMoveToken({ mode: 'exploration', status: 'preparing', currentTurnIndex: 0 }, { turnOrder: 0 }, false, true),
    ).toBe(true);
  });

  it('a non-DM cannot move a token that is not their own', () => {
    expect(
      canMoveToken({ mode: 'exploration', status: 'active', currentTurnIndex: 0 }, { turnOrder: 0 }, false, false),
    ).toBe(false);
  });

  it('a player can move their own token freely in exploration mode, regardless of status or turn', () => {
    expect(
      canMoveToken({ mode: 'exploration', status: 'active', currentTurnIndex: 3 }, { turnOrder: 0 }, true, false),
    ).toBe(true);
    expect(
      canMoveToken({ mode: 'exploration', status: 'preparing', currentTurnIndex: 0 }, { turnOrder: 0 }, true, false),
    ).toBe(true);
  });

  it('a player can move their own token freely in combat mode when the encounter is not active', () => {
    expect(
      canMoveToken({ mode: 'combat', status: 'preparing', currentTurnIndex: 0 }, { turnOrder: 0 }, true, false),
    ).toBe(true);
  });

  it('a player can move their own token only on their own turn once combat mode is active', () => {
    expect(
      canMoveToken({ mode: 'combat', status: 'active', currentTurnIndex: 0 }, { turnOrder: 0 }, true, false),
    ).toBe(true);
    expect(
      canMoveToken({ mode: 'combat', status: 'active', currentTurnIndex: 1 }, { turnOrder: 0 }, true, false),
    ).toBe(false);
  });
});

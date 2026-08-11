// Unit test for resolveHpForViewer (Phase 2 "restore hp_visibility +
// banding") — pure, no DB/socket.io, same rationale as
// broadcastDiceRollPayloads.test.ts (see that file's header comment).

import { describe, expect, it } from 'vitest';
import { resolveHpForViewer } from './broadcast.js';

describe('resolveHpForViewer', () => {
  it('gives the DM exact numbers regardless of hp_visibility, plus the real setting', () => {
    for (const hpVisibility of ['exact', 'banded', 'hidden'] as const) {
      const result = resolveHpForViewer({ hpCurrent: 12, hpMax: 40, hpTemp: 0, hpVisibility }, 'dm', false);
      expect(result).toEqual({ hpVisibility, hpCurrent: 12, hpMax: 40, hpTemp: 0 });
    }
  });

  it("gives a player exact numbers when hp_visibility is 'exact'", () => {
    const result = resolveHpForViewer({ hpCurrent: 12, hpMax: 40, hpTemp: 0, hpVisibility: 'exact' }, 'player', false);
    expect(result).toEqual({ hpVisibility: 'exact', hpCurrent: 12, hpMax: 40, hpTemp: 0 });
  });

  it("gives a player only a computed band when hp_visibility is 'banded', never raw numbers", () => {
    const result = resolveHpForViewer({ hpCurrent: 12, hpMax: 40, hpTemp: 0, hpVisibility: 'banded' }, 'player', false);
    expect(result).toEqual({ hpVisibility: 'banded', band: 'bloodied' }); // 12/40 = 30%, in (25%, 50%]
    expect(result).not.toHaveProperty('hpCurrent');
    expect(result).not.toHaveProperty('hpMax');
  });

  it("gives a player nothing at all when hp_visibility is 'hidden'", () => {
    const result = resolveHpForViewer({ hpCurrent: 12, hpMax: 40, hpTemp: 0, hpVisibility: 'hidden' }, 'player', false);
    expect(result).toEqual({ hpVisibility: 'hidden' });
  });

  it('a spectator is treated the same as a player (never dm)', () => {
    const result = resolveHpForViewer({ hpCurrent: 12, hpMax: 40, hpTemp: 0, hpVisibility: 'hidden' }, 'spectator', false);
    expect(result).toEqual({ hpVisibility: 'hidden' });
  });

  it('a character participant always gets exact numbers for a player too, even when hp_visibility is hidden — confirmed scope is monster HP only', () => {
    const result = resolveHpForViewer({ hpCurrent: 3, hpMax: 40, hpTemp: 0, hpVisibility: 'hidden' }, 'player', true);
    expect(result).toEqual({ hpVisibility: 'hidden', hpCurrent: 3, hpMax: 40, hpTemp: 0 });
  });
});

// Pure unit test for the Bastion Events d20 table (docs/rules/bastions.md
// §6) — exhaustive over the full 1-20 range, same "catch a transcription
// typo" purpose as xpBudget.test.ts's threshold-table checks.

import { describe, expect, it } from 'vitest';
import { eventKeyForD20Roll } from './bastionEvents.js';

describe('eventKeyForD20Roll', () => {
  it('maps every roll 1-20 to the documented event exactly', () => {
    const expected: Record<number, string> = {
      1: 'nothing', 2: 'nothing', 3: 'nothing', 4: 'nothing', 5: 'nothing',
      6: 'nothing', 7: 'nothing', 8: 'nothing', 9: 'nothing',
      10: 'attack',
      11: 'lost_hirelings', 12: 'lost_hirelings',
      13: 'refugees', 14: 'refugees',
      15: 'friendly_visitors',
      16: 'request_for_aid',
      17: 'honored_guest',
      18: 'extraordinary_opportunity',
      19: 'criminal_hireling',
      20: 'magical_discovery',
    };
    for (let roll = 1; roll <= 20; roll++) {
      expect(eventKeyForD20Roll(roll)).toBe(expected[roll]);
    }
  });
});

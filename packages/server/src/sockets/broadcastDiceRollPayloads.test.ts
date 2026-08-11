// Unit test for buildDiceRollBroadcastPayloads (Phase 2 "hidden rolls
// record occurrence") — pure, no DB/socket.io, see its own comment in
// broadcast.ts for why the masking RULE is unit-tested here while the
// actual emit plumbing isn't (no socket.io harness precedent in this suite).

import { describe, expect, it } from 'vitest';
import { buildDiceRollBroadcastPayloads, type DiceRollBroadcastRow } from './broadcast.js';

function makeRoll(overrides: Partial<DiceRollBroadcastRow> = {}): DiceRollBroadcastRow {
  return {
    id: 'roll-1',
    campaign_id: 'campaign-1',
    user_id: 'roller-1',
    character_id: 'character-1',
    monster_instance_id: null,
    encounter_id: null,
    roll_type: 'saving_throw',
    roll_context: 'Wisdom Save',
    d20_rolls: [14],
    keep: 'normal',
    dice_sides: 20,
    dice_count: 1,
    modifier: 2,
    result_total: 16,
    is_critical: false,
    visibility: 'gm_only',
    visible_to_user_id: null,
    is_manual: false,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildDiceRollBroadcastPayloads', () => {
  it('the full payload carries every result-bearing field', () => {
    const roll = makeRoll();
    const { full } = buildDiceRollBroadcastPayloads('campaign-1', roll, 1000);
    expect(full).toMatchObject({
      masked: false,
      id: roll.id,
      rollType: roll.roll_type,
      rollContext: roll.roll_context,
      d20Rolls: roll.d20_rolls,
      resultTotal: roll.result_total,
      modifier: roll.modifier,
      isCritical: roll.is_critical,
      characterId: roll.character_id,
      userId: roll.user_id,
    });
  });

  it('the masked payload keeps id/roller/context/type but strips every result-bearing field', () => {
    const roll = makeRoll();
    const { masked } = buildDiceRollBroadcastPayloads('campaign-1', roll, 1000);

    expect(masked).toMatchObject({
      masked: true,
      id: roll.id,
      rollType: roll.roll_type,
      rollContext: roll.roll_context,
      visibility: roll.visibility,
      characterId: roll.character_id,
      userId: roll.user_id,
    });
    for (const resultField of ['d20Rolls', 'keep', 'diceSides', 'diceCount', 'modifier', 'resultTotal', 'isCritical', 'isManual']) {
      expect(masked).not.toHaveProperty(resultField);
    }
  });

  it('is stable regardless of the roll\'s visibility (masking is decided by the caller, not this function)', () => {
    const privateRoll = makeRoll({ visibility: 'private', visible_to_user_id: 'target-1' });
    const { masked } = buildDiceRollBroadcastPayloads('campaign-1', privateRoll, 1000);
    expect(masked.visibility).toBe('private');
    expect(masked).not.toHaveProperty('resultTotal');
  });
});

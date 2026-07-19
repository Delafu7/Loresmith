import { describe, expect, it } from 'vitest';
import { applyHpDeltaWithTempAbsorption } from './hp.js';

describe('applyHpDeltaWithTempAbsorption', () => {
  it('applies plain damage to real HP when there is no temp HP', () => {
    const result = applyHpDeltaWithTempAbsorption({ hp_current: 20, hp_max: 28, hp_temp: 0 }, { delta: -5, tempDelta: 0 });
    expect(result).toEqual({ hpCurrent: 15, hpTemp: 0 });
  });

  it('damage is absorbed by temp HP before touching real HP', () => {
    const result = applyHpDeltaWithTempAbsorption({ hp_current: 20, hp_max: 28, hp_temp: 10 }, { delta: -5, tempDelta: 0 });
    expect(result).toEqual({ hpCurrent: 20, hpTemp: 5 });
  });

  it('damage exceeding temp HP depletes it fully and carries the remainder to real HP', () => {
    const result = applyHpDeltaWithTempAbsorption({ hp_current: 20, hp_max: 28, hp_temp: 10 }, { delta: -15, tempDelta: 0 });
    expect(result).toEqual({ hpCurrent: 15, hpTemp: 0 });
  });

  it('real HP never drops below 0', () => {
    const result = applyHpDeltaWithTempAbsorption({ hp_current: 5, hp_max: 28, hp_temp: 0 }, { delta: -999, tempDelta: 0 });
    expect(result).toEqual({ hpCurrent: 0, hpTemp: 0 });
  });

  it('healing restores real HP and is clamped at hp_max', () => {
    const result = applyHpDeltaWithTempAbsorption({ hp_current: 20, hp_max: 28, hp_temp: 0 }, { delta: 999, tempDelta: 0 });
    expect(result).toEqual({ hpCurrent: 28, hpTemp: 0 });
  });

  it('healing does not touch existing temp HP', () => {
    const result = applyHpDeltaWithTempAbsorption({ hp_current: 20, hp_max: 28, hp_temp: 6 }, { delta: 3, tempDelta: 0 });
    expect(result).toEqual({ hpCurrent: 23, hpTemp: 6 });
  });

  it('a new temp HP grant higher than the current amount replaces it (does not stack)', () => {
    const result = applyHpDeltaWithTempAbsorption({ hp_current: 20, hp_max: 28, hp_temp: 5 }, { delta: 0, tempDelta: 12 });
    expect(result).toEqual({ hpCurrent: 20, hpTemp: 12 });
  });

  it('a new temp HP grant lower than the current amount is ignored (you keep the higher one)', () => {
    const result = applyHpDeltaWithTempAbsorption({ hp_current: 20, hp_max: 28, hp_temp: 12 }, { delta: 0, tempDelta: 5 });
    expect(result).toEqual({ hpCurrent: 20, hpTemp: 12 });
  });

  it('damage and a simultaneous temp HP grant both apply, in that order (damage resolves against the pre-grant temp HP)', () => {
    const result = applyHpDeltaWithTempAbsorption({ hp_current: 20, hp_max: 28, hp_temp: 3 }, { delta: -5, tempDelta: 10 });
    // 3 temp HP absorbs 3 of the 5 damage, 2 carries to real HP (20 -> 18);
    // the incoming 10 temp HP grant is then compared against the *post-damage*
    // temp HP (0), so it simply sets temp HP to 10.
    expect(result).toEqual({ hpCurrent: 18, hpTemp: 10 });
  });
});

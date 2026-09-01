import { describe, expect, it } from 'vitest';
import {
  EXHAUSTION_MAX_LEVEL,
  FOOD_NEEDS_POUNDS_PER_DAY,
  WATER_NEEDS_GALLONS_PER_DAY,
  applyExhaustionDelta,
  burningTick,
  dehydrationOutcome,
  malnutritionOutcome,
  suffocationOutcome,
} from './hazards.js';

// docs/roadmap/dnd-2024-gap-analysis.md P3-3 (ER-08) — pure-function coverage
// for the four environmental hazards. Full rules citations live in
// domain/hazards.ts and docs/rules/environmental-hazards.md; these tests pin
// the numbers and, above all, the 2014/2024 divergences (every hazard
// diverges — Suffocation the most).

describe('applyExhaustionDelta', () => {
  it('adds levels and clamps at 0 and 6', () => {
    expect(applyExhaustionDelta(0, 1)).toMatchObject({ before: 0, after: 1, applied: 1, reachedLethalLevel: false });
    expect(applyExhaustionDelta(2, -3)).toMatchObject({ after: 0, applied: -2 });
    expect(applyExhaustionDelta(5, 4)).toMatchObject({ after: 6, applied: 1, reachedLethalLevel: true });
    expect(applyExhaustionDelta(6, 0).reachedLethalLevel).toBe(true);
    expect(EXHAUSTION_MAX_LEVEL).toBe(6);
  });
});

describe('burningTick', () => {
  it('is 1d4 Fire at the start of the turn in both editions', () => {
    for (const edition of ['2014', '2024'] as const) {
      const tick = burningTick(edition);
      expect(tick).toMatchObject({ diceCount: 1, diceSides: 4, damageType: 'fire', timing: 'start_of_turn' });
      expect(tick.endConditions.length).toBeGreaterThan(0);
    }
  });

  it('2024 names the Prone-and-roll action; 2014 points back to the source', () => {
    expect(burningTick('2024').endConditions.join(' ')).toMatch(/Prone/i);
    expect(burningTick('2014').endConditions.join(' ')).toMatch(/triggering source/i);
    expect(burningTick('2014').notes.join(' ')).toMatch(/no single generic "Burning" hazard/i);
  });
});

describe('dehydrationOutcome — 2024', () => {
  it('exposes the size table (rulesGlossary.md:748)', () => {
    expect(WATER_NEEDS_GALLONS_PER_DAY).toMatchObject({ tiny: 0.25, small: 1, medium: 1, large: 4, huge: 16, gargantuan: 64 });
  });

  it('drinking at least half the requirement is safe; less than half is 1 level, no save', () => {
    expect(dehydrationOutcome({ edition: '2024', size: 'medium', gallonsConsumed: 0.5 }).exhaustionLevelsGained).toBe(0);
    const dry = dehydrationOutcome({ edition: '2024', size: 'medium', gallonsConsumed: 0.4 });
    expect(dry.exhaustionLevelsGained).toBe(1);
    expect(dry.requiresSave).toBe(false);
  });

  it('scales the threshold by size (a Large creature needs 4 gallons, half = 2)', () => {
    expect(dehydrationOutcome({ edition: '2024', size: 'large', gallonsConsumed: 2 }).exhaustionLevelsGained).toBe(0);
    expect(dehydrationOutcome({ edition: '2024', size: 'large', gallonsConsumed: 1.9 }).exhaustionLevelsGained).toBe(1);
  });
});

describe('dehydrationOutcome — 2014', () => {
  it('full water = safe; hot weather doubles the requirement', () => {
    expect(dehydrationOutcome({ edition: '2014', gallonsConsumed: 1 }).exhaustionLevelsGained).toBe(0);
    // Hot: needs 2 gallons, so 1 gallon is exactly half -> the DC 15 save path.
    const hot = dehydrationOutcome({ edition: '2014', gallonsConsumed: 1, hotWeather: true });
    expect(hot.requiresSave).toBe(true);
    expect(hot.saveDc).toBe(15);
  });

  it('half-or-more-but-not-full: DC 15 Con save or 1 level', () => {
    const failed = dehydrationOutcome({ edition: '2014', gallonsConsumed: 0.5, saveSucceeded: false });
    expect(failed.exhaustionLevelsGained).toBe(1);
    const passed = dehydrationOutcome({ edition: '2014', gallonsConsumed: 0.5, saveSucceeded: true });
    expect(passed.exhaustionLevelsGained).toBe(0);
  });

  it('less than half: automatic 1 level, no save', () => {
    const auto = dehydrationOutcome({ edition: '2014', gallonsConsumed: 0.1 });
    expect(auto.exhaustionLevelsGained).toBe(1);
    expect(auto.requiresSave).toBe(false);
  });

  it('already exhausted doubles a failed/automatic result to 2 levels (adventuring.md:147)', () => {
    expect(dehydrationOutcome({ edition: '2014', gallonsConsumed: 0.1, currentExhaustionLevel: 1 }).exhaustionLevelsGained).toBe(2);
    expect(
      dehydrationOutcome({ edition: '2014', gallonsConsumed: 0.5, saveSucceeded: false, currentExhaustionLevel: 3 }).exhaustionLevelsGained,
    ).toBe(2);
    // A SUCCESSFUL save is still 0 even when already exhausted (nothing to double).
    expect(
      dehydrationOutcome({ edition: '2014', gallonsConsumed: 0.5, saveSucceeded: true, currentExhaustionLevel: 3 }).exhaustionLevelsGained,
    ).toBe(0);
  });
});

describe('malnutritionOutcome — 2024', () => {
  it('exposes the size table (rulesGlossary.md:1176)', () => {
    expect(FOOD_NEEDS_POUNDS_PER_DAY).toMatchObject({ tiny: 0.25, small: 1, medium: 1, large: 4, huge: 16, gargantuan: 64 });
  });

  it('ate at least half = safe', () => {
    expect(malnutritionOutcome({ edition: '2024', size: 'medium', poundsConsumed: 0.5 }).exhaustionLevelsGained).toBe(0);
  });

  it('ate something but less than half: DC 10 Con save or 1 level', () => {
    const failed = malnutritionOutcome({ edition: '2024', size: 'medium', poundsConsumed: 0.25, saveSucceeded: false });
    expect(failed).toMatchObject({ exhaustionLevelsGained: 1, requiresSave: true, saveDc: 10 });
    expect(malnutritionOutcome({ edition: '2024', size: 'medium', poundsConsumed: 0.25, saveSucceeded: true }).exhaustionLevelsGained).toBe(0);
  });

  it('ate nothing: no effect before the 5th consecutive day, then +1 per day, no save', () => {
    expect(malnutritionOutcome({ edition: '2024', poundsConsumed: 0, consecutiveDaysWithoutFood: 4 }).exhaustionLevelsGained).toBe(0);
    const day5 = malnutritionOutcome({ edition: '2024', poundsConsumed: 0, consecutiveDaysWithoutFood: 5 });
    expect(day5).toMatchObject({ exhaustionLevelsGained: 1, requiresSave: false });
    expect(malnutritionOutcome({ edition: '2024', poundsConsumed: 0, consecutiveDaysWithoutFood: 9 }).exhaustionLevelsGained).toBe(1);
  });
});

describe('malnutritionOutcome — 2014', () => {
  it('grace period is 3 + CON mod, minimum 1 day; exhaustion only past it', () => {
    // CON mod +2 -> grace 5. Day 5 is within, day 6 is past.
    expect(malnutritionOutcome({ edition: '2014', poundsConsumed: 0, consecutiveDaysWithoutFood: 5, conModifier: 2 }).exhaustionLevelsGained).toBe(0);
    expect(malnutritionOutcome({ edition: '2014', poundsConsumed: 0, consecutiveDaysWithoutFood: 6, conModifier: 2 }).exhaustionLevelsGained).toBe(1);
  });

  it('a very low CON still gets a 1-day grace floor', () => {
    // CON mod -5 -> 3 + (-5) = -2 -> floored to 1. Day 1 within, day 2 past.
    expect(malnutritionOutcome({ edition: '2014', poundsConsumed: 0, consecutiveDaysWithoutFood: 1, conModifier: -5 }).exhaustionLevelsGained).toBe(0);
    expect(malnutritionOutcome({ edition: '2014', poundsConsumed: 0, consecutiveDaysWithoutFood: 2, conModifier: -5 }).exhaustionLevelsGained).toBe(1);
  });

  it('2014 malnutrition never involves a saving throw', () => {
    expect(malnutritionOutcome({ edition: '2014', poundsConsumed: 0.25, consecutiveDaysWithoutFood: 10, conModifier: 0 }).requiresSave).toBe(false);
  });
});

describe('suffocationOutcome', () => {
  it('breath-hold is 1 + CON mod minutes, floored at 30 seconds', () => {
    expect(suffocationOutcome({ edition: '2024', conModifier: 3 }).breathHoldMinutes).toBe(4);
    expect(suffocationOutcome({ edition: '2024', conModifier: 0 }).breathHoldMinutes).toBe(1);
    expect(suffocationOutcome({ edition: '2024', conModifier: -1 }).breathHoldMinutes).toBe(0.5);
    expect(suffocationOutcome({ edition: '2024', conModifier: -4 }).breathHoldMinutes).toBe(0.5);
  });

  it('2024: 1 Exhaustion per turn, all removed on breathing again; no HP drop', () => {
    const o = suffocationOutcome({ edition: '2024', conModifier: 1 });
    expect(o).toMatchObject({ exhaustionPerTurn: 1, removesAllSuffocationExhaustionOnBreathing: true, roundsBeforeDropTo0Hp: null });
  });

  it('2014: no Exhaustion — survives max(1, CON mod) rounds then drops to 0 HP', () => {
    expect(suffocationOutcome({ edition: '2014', conModifier: 3 })).toMatchObject({
      exhaustionPerTurn: 0,
      removesAllSuffocationExhaustionOnBreathing: false,
      roundsBeforeDropTo0Hp: 3,
    });
    expect(suffocationOutcome({ edition: '2014', conModifier: -2 }).roundsBeforeDropTo0Hp).toBe(1);
  });
});

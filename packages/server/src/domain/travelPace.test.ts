import { describe, expect, it } from 'vitest';
import {
  TRAVEL_PACE_TABLE,
  DEFAULT_TRAVEL_HOURS_PER_DAY,
  computeTravelPlan,
  forcedMarchSchedule,
  mountedBurst,
  paceEffects,
  terrainEffect,
} from './travelPace.js';

// docs/roadmap/dnd-2024-gap-analysis.md P3-2 (ER-07) — pure-function coverage
// for the stateless Travel Pace calculator. Full rules citations live in
// domain/travelPace.ts and docs/rules/travel-pace.md; these tests pin the
// numbers and, above all, the 2014/2024 divergences (pace effects, difficult
// terrain, forced march, mount wording).

describe('TRAVEL_PACE_TABLE', () => {
  it('matches the SRD table (identical in both editions)', () => {
    expect(TRAVEL_PACE_TABLE.fast).toEqual({ feetPerMinute: 400, milesPerHour: 4, milesPerDay: 30 });
    expect(TRAVEL_PACE_TABLE.normal).toEqual({ feetPerMinute: 300, milesPerHour: 3, milesPerDay: 24 });
    expect(TRAVEL_PACE_TABLE.slow).toEqual({ feetPerMinute: 200, milesPerHour: 2, milesPerDay: 18 });
    expect(DEFAULT_TRAVEL_HOURS_PER_DAY).toBe(8);
  });
});

describe('computeTravelPlan — distance', () => {
  it('derives an hour-scale distance from milesPerHour, in miles and feet', () => {
    const plan = computeTravelPlan({ edition: '2024', pace: 'fast', hours: 10 });
    expect(plan.distance.miles).toBe(40);
    expect(plan.distance.feet).toBe(40 * 5280);
  });

  it('handles fractional hours without ever reading the Day column', () => {
    const plan = computeTravelPlan({ edition: '2014', pace: 'normal', hours: 2.5 });
    expect(plan.distance.miles).toBe(7.5);
  });

  it('2014: difficult terrain halves the distance', () => {
    const plan = computeTravelPlan({ edition: '2014', pace: 'normal', hours: 3, terrain: 'difficult' });
    expect(plan.terrain.multiplier).toBe(0.5);
    expect(plan.distance.miles).toBe(4.5);
  });

  it('2024: difficult terrain does NOT change the distance, and says why', () => {
    const plan = computeTravelPlan({ edition: '2024', pace: 'normal', hours: 3, terrain: 'difficult' });
    expect(plan.terrain.multiplier).toBe(1);
    expect(plan.distance.miles).toBe(9);
    expect(plan.terrain.notes.join(' ')).toMatch(/Dungeon Master’s Guide/);
  });

  it('scales the per-day figure to a non-default travel day', () => {
    const plan = computeTravelPlan({ edition: '2014', pace: 'normal', hours: 4, hoursPerDay: 6 });
    expect(plan.perDay.hours).toBe(6);
    expect(plan.perDay.distance.miles).toBe(18); // 24 mi/day * (6/8)
  });
});

describe('paceEffects — 2014', () => {
  it('fast is a flat −5 to passive Perception only, not Disadvantage', () => {
    const e = paceEffects('fast', '2014', 'foot');
    expect(e.passivePerceptionModifier).toBe(-5);
    expect(e.advantage).toEqual([]);
    expect(e.disadvantage).toEqual([]);
  });

  it('normal has no mechanical effect', () => {
    const e = paceEffects('normal', '2014', 'foot');
    expect(e).toMatchObject({ advantage: [], disadvantage: [], passivePerceptionModifier: 0 });
  });

  it('slow grants no roll bonus — only a stealth/search permission note', () => {
    const e = paceEffects('slow', '2014', 'foot');
    expect(e.advantage).toEqual([]);
    expect(e.passivePerceptionModifier).toBe(0);
    expect(e.notes.join(' ')).toMatch(/stealthily/);
  });
});

describe('paceEffects — 2024', () => {
  it('fast imposes Disadvantage on Perception, Survival AND Stealth', () => {
    const e = paceEffects('fast', '2024', 'foot');
    expect(e.disadvantage).toEqual(['Wisdom (Perception)', 'Wisdom (Survival)', 'Dexterity (Stealth)']);
    expect(e.passivePerceptionModifier).toBe(0);
  });

  it('normal imposes Disadvantage on Stealth only', () => {
    expect(paceEffects('normal', '2024', 'foot').disadvantage).toEqual(['Dexterity (Stealth)']);
  });

  it('slow grants Advantage on Perception and Survival, and does not touch Stealth', () => {
    const e = paceEffects('slow', '2024', 'foot');
    expect(e.advantage).toEqual(['Wisdom (Perception)', 'Wisdom (Survival)']);
    expect(e.disadvantage).toEqual([]);
  });
});

describe('paceEffects — waterborne', () => {
  it('applies no pace effects regardless of edition or pace', () => {
    for (const edition of ['2014', '2024'] as const) {
      const e = paceEffects('fast', edition, 'waterborne');
      expect(e).toMatchObject({ advantage: [], disadvantage: [], passivePerceptionModifier: 0 });
      expect(e.notes.join(' ')).toMatch(/waterborne vessel/);
    }
  });
});

describe('forcedMarchSchedule — 2014', () => {
  it('a full 8-hour day carries no forced-march risk', () => {
    const s = forcedMarchSchedule('2014', 8, 'foot');
    expect(s.applies).toBe(false);
    expect(s.saves).toEqual([]);
  });

  it('11 hours produces saves at hours 9/10/11 with DC 11/12/13', () => {
    const s = forcedMarchSchedule('2014', 11, 'foot');
    expect(s.applies).toBe(true);
    expect(s.forcedHours).toBe(3);
    expect(s.saves).toEqual([
      { hour: 9, dc: 11 },
      { hour: 10, dc: 12 },
      { hour: 11, dc: 13 },
    ]);
    expect(s.onFailure).toMatch(/exhaustion/);
  });

  it('a partial final hour triggers no save', () => {
    const s = forcedMarchSchedule('2014', 10.5, 'foot');
    expect(s.saves.map((x) => x.hour)).toEqual([9, 10]);
  });

  it('the daily limit is not hardcoded to 8', () => {
    const s = forcedMarchSchedule('2014', 8, 'foot', 6);
    expect(s.saves).toEqual([
      { hour: 7, dc: 11 },
      { hour: 8, dc: 12 },
    ]);
  });

  it('a land vehicle still incurs saves, but flags the ambiguity', () => {
    const s = forcedMarchSchedule('2014', 10, 'land_vehicle');
    expect(s.applies).toBe(true);
    expect(s.notes.join(' ')).toMatch(/land vehicle/);
  });

  it('a waterborne vessel is exempt (up to 24h/day)', () => {
    const s = forcedMarchSchedule('2014', 20, 'waterborne');
    expect(s.applies).toBe(false);
    expect(s.notes.join(' ')).toMatch(/24 hours/);
  });
});

describe('forcedMarchSchedule — 2024', () => {
  it('never applies — the mechanic was removed', () => {
    const s = forcedMarchSchedule('2024', 20, 'foot');
    expect(s.applies).toBe(false);
    expect(s.saves).toEqual([]);
    expect(s.notes.join(' ')).toMatch(/no forced-march rule/);
  });
});

describe('mountedBurst', () => {
  it('2014: burst is twice the FAST-pace distance regardless of chosen pace', () => {
    const burst = mountedBurst('slow', '2014', terrainEffect('normal', '2014', 'mounted'));
    expect(burst.distance.miles).toBe(8); // 2 * 4 mi (fast), not 2 * 2 mi (slow)
  });

  it('2024: burst is twice the CHOSEN pace distance', () => {
    const burst = mountedBurst('slow', '2024', terrainEffect('normal', '2024', 'mounted'));
    expect(burst.distance.miles).toBe(4);
    expect(burst.thenRequires).toMatch(/Short or Long Rest/);
  });

  it('2014: difficult terrain still halves the burst', () => {
    const burst = mountedBurst('normal', '2014', terrainEffect('difficult', '2014', 'mounted'));
    expect(burst.distance.miles).toBe(4); // 2 * 4 mi (fast) * 0.5
  });
});

describe('computeTravelPlan — mode wiring', () => {
  it('mounted mode attaches the burst report; foot does not', () => {
    expect(computeTravelPlan({ edition: '2024', pace: 'normal', hours: 6, mode: 'mounted' }).mountedBurst).not.toBeNull();
    expect(computeTravelPlan({ edition: '2024', pace: 'normal', hours: 6 }).mountedBurst).toBeNull();
  });

  it('waterborne mode uses the vessel speed, ignores pace, and reports a 24h day', () => {
    const plan = computeTravelPlan({ edition: '2024', pace: 'fast', hours: 10, mode: 'waterborne', vesselSpeedMilesPerHour: 6 });
    expect(plan.distance.miles).toBe(60);
    expect(plan.perDay.hours).toBe(24);
    expect(plan.paceEffects.advantage).toEqual([]);
    expect(plan.paceEffects.disadvantage).toEqual([]);
  });
});

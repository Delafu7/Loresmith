// docs/roadmap/dnd-2024-gap-analysis.md P3-2 (ER-07) — overland Travel Pace,
// scoped (confirmed with the user first) to a STATELESS CALCULATOR: pure
// functions plus one read-only endpoint that reports distance/time,
// edition-branched pace effects, and the 2014 forced-march save schedule for
// a DM/player to adjudicate. No DB, no `travel_journeys` table, no
// forced-march save persistence, no automatic exhaustion application — the
// same "compute-and-suggest, never enforce" precedent as domain/obscurement.ts
// (P2-6) and services/conditionEffects.ts (P2-2). Marching order is
// deliberately out of scope (a separate follow-up).
//
// Full rules writeup with per-line citations: docs/rules/travel-pace.md.
// Primary sources:
//   - 2014: .opencode/skills/dnd5e-srd/references/2014/adventuring.md L30-56
//   - 2024: .opencode/skills/dnd5e-srd/references/2024/adventuring.md L43-67;
//           docs/players-handbook-2024/Chapter 1- Playing the Game/
//           chapter1-playindTheGame.md L870-903
//   - .claude/skills/dnd-2024-rules/references/exploration-and-rest.md L5-12
//
// This app stores every distance in feet (movement.ts feetPerCell,
// characters.speed, the map grid), so this module works in feet/miles and
// leaves the metric display conversion to the frontend (users.unit_system),
// exactly as the rest of the server does.

export type Pace = 'fast' | 'normal' | 'slow';
export type TravelEdition = '2014' | '2024';
export type TravelMode = 'foot' | 'mounted' | 'land_vehicle' | 'waterborne';
export type TravelTerrain = 'normal' | 'difficult';

const FEET_PER_MILE = 5280;

/**
 * The pace table — IDENTICAL in 2014 and 2024 (SRD 5.1 adventuring.md L44-50;
 * PHB 2024 L884-891; SRD 5.2 adventuring.md L49-55 all agree), so it is NOT
 * edition-keyed. Note the table is internally inconsistent between its
 * columns (400 ft/min * 60 = 24000 ft/hr, but the Hour column is 4 mi =
 * 21120 ft/hr; the Day column is not exactly 8 * Hour either — "4x8=32~=30").
 * Per the rule text you use the column that matches the timescale you're
 * asking about rather than recomputing one from another; this module reports
 * the raw table figures and derives an hour-scale distance from
 * `milesPerHour` (what a DM plans around), never from `feetPerMinute`.
 */
export interface PaceTableRow {
  feetPerMinute: number;
  milesPerHour: number;
  milesPerDay: number;
}

export const TRAVEL_PACE_TABLE: Record<Pace, PaceTableRow> = {
  fast: { feetPerMinute: 400, milesPerHour: 4, milesPerDay: 30 },
  normal: { feetPerMinute: 300, milesPerHour: 3, milesPerDay: 24 },
  slow: { feetPerMinute: 200, milesPerHour: 2, milesPerDay: 18 },
};

// SRD 5.1 adventuring.md L34: "The Travel Pace table assumes that characters
// travel for 8 hours in [a] day." 2024 doesn't restate the figure but its
// Day column is still built on it. Exposed as a constant (and overridable
// per call) so the forced-march threshold and DC aren't hardcoded to 8 —
// a DM may set a shorter/longer travel day.
export const DEFAULT_TRAVEL_HOURS_PER_DAY = 8;

export interface Distance {
  feet: number;
  miles: number;
}

function milesToDistance(miles: number): Distance {
  return { feet: Math.round(miles * FEET_PER_MILE), miles: Math.round(miles * 1000) / 1000 };
}

export interface TerrainEffect {
  type: TravelTerrain;
  /** The multiplier actually applied to distance (1 = none, 0.5 = halved). */
  multiplier: number;
  notes: string[];
}

/**
 * Difficult terrain — DIVERGES by edition.
 *  - 2014 (adventuring.md L52-56): "you can cover only half the normal
 *    distance in a minute, an hour, or a day" — a flat x0.5, single
 *    application (no x0.25 stacking; the text offers no stacking mechanism).
 *  - 2024: the travel section has NO difficult-terrain rule — PHB 2024 L882
 *    defers it to the DMG, which is not in this repo. So the RAW-faithful
 *    default is to leave the distance UNMODIFIED and say so, rather than
 *    silently borrowing the 2014 or the combat-movement rule.
 */
export function terrainEffect(terrain: TravelTerrain, edition: TravelEdition, mode: TravelMode): TerrainEffect {
  if (terrain === 'normal') return { type: 'normal', multiplier: 1, notes: [] };
  if (mode === 'waterborne') {
    return {
      type: 'difficult',
      multiplier: 1,
      notes: ['Difficult terrain does not apply to a waterborne vessel.'],
    };
  }
  if (edition === '2014') {
    return {
      type: 'difficult',
      multiplier: 0.5,
      notes: ['2014: difficult terrain halves the distance covered per minute, hour, and day (applied once, even with several overlapping terrain types).'],
    };
  }
  return {
    type: 'difficult',
    multiplier: 1,
    notes: [
      '2024: the SRD travel rules defer difficult-terrain effects to the Dungeon Master’s Guide (not modeled here); the distance shown is unmodified. A DM may rule it halved, as in 2014, or that it forbids the faster paces.',
    ],
  };
}

export interface PaceEffects {
  /** 2024 only: skill checks made with Advantage at this pace. */
  advantage: string[];
  /** 2024 only: skill checks made with Disadvantage at this pace. */
  disadvantage: string[];
  /** 2014 only: flat modifier to passive Wisdom (Perception) (Fast = -5). */
  passivePerceptionModifier: number;
  notes: string[];
}

/**
 * Pace effects on checks/passive scores — HARD DIVERGENCE, edition-branched.
 *
 * 2014 (adventuring.md L46-50):
 *   Fast   -> "-5 penalty to passive Wisdom (Perception) scores" (flat, and
 *             ONLY passive Perception — not active checks, Survival, or Stealth)
 *   Normal -> no effect
 *   Slow   -> "able to use stealth" (a permission to travel stealthily / search
 *             carefully; no die-roll bonus is specified)
 *
 * 2024 (PHB 2024 L893-899; SRD 5.2 adventuring.md L53-55):
 *   Fast   -> Disadvantage on Wis (Perception), Wis (Survival), Dex (Stealth)
 *   Normal -> Disadvantage on Dex (Stealth) only
 *   Slow   -> Advantage on Wis (Perception), Wis (Survival)
 *
 * A waterborne vessel applies NO pace effects in either edition (2014: no fast
 * penalty / slow benefit; 2024: travelers "don't choose a travel pace") —
 * adventuring.md 2014 L40, 2024 L57-61.
 */
export function paceEffects(pace: Pace, edition: TravelEdition, mode: TravelMode): PaceEffects {
  if (mode === 'waterborne') {
    return {
      advantage: [],
      disadvantage: [],
      passivePerceptionModifier: 0,
      notes: ['Travel-pace effects do not apply aboard a waterborne vessel; its speed and any crew-imposed limits govern instead.'],
    };
  }

  if (edition === '2014') {
    if (pace === 'fast') {
      return {
        advantage: [],
        disadvantage: [],
        passivePerceptionModifier: -5,
        notes: ['2014: a fast pace imposes a flat −5 penalty to passive Wisdom (Perception). It does not affect active Perception, Survival, or Stealth checks, and it is not Disadvantage.'],
      };
    }
    if (pace === 'normal') {
      return { advantage: [], disadvantage: [], passivePerceptionModifier: 0, notes: ['2014: a normal pace has no mechanical effect while traveling.'] };
    }
    return {
      advantage: [],
      disadvantage: [],
      passivePerceptionModifier: 0,
      notes: ['2014: a slow pace lets the party travel stealthily and search the area more carefully. The SRD specifies no die-roll bonus for this — the DM adjudicates.'],
    };
  }

  // 2024
  if (pace === 'fast') {
    return {
      advantage: [],
      disadvantage: ['Wisdom (Perception)', 'Wisdom (Survival)', 'Dexterity (Stealth)'],
      passivePerceptionModifier: 0,
      notes: ['2024: passive Perception is also effectively −5 while at a fast pace, as a downstream consequence of the Disadvantage on the check — do not apply it a second time.'],
    };
  }
  if (pace === 'normal') {
    return { advantage: [], disadvantage: ['Dexterity (Stealth)'], passivePerceptionModifier: 0, notes: [] };
  }
  return { advantage: ['Wisdom (Perception)', 'Wisdom (Survival)'], disadvantage: [], passivePerceptionModifier: 0, notes: [] };
}

export interface ForcedMarchSave {
  /** The hour-of-day this save is made at the end of (first forced hour = hoursPerDay + 1). */
  hour: number;
  /** SRD 5.1 adventuring.md L36: "The DC is 10 + 1 for each hour past 8 hours." */
  dc: number;
}

export interface ForcedMarchSchedule {
  applies: boolean;
  hoursBeforeExhaustionRisk: number;
  /** Full hours traveled beyond the daily limit (partial hours don't trigger a save). */
  forcedHours: number;
  saves: ForcedMarchSave[];
  onFailure: string;
  notes: string[];
}

/**
 * Forced March — 2014 ONLY. adventuring.md L34-36: past 8 hours in a day,
 * "each character must make a Constitution saving throw at the end of the
 * hour. The DC is 10 + 1 for each hour past 8 hours. On a failed saving
 * throw, a character suffers one level of exhaustion."
 *
 * 2024 removed this mechanic entirely — there is no 8-hour limit, no
 * push-on save, no travel-induced exhaustion anywhere in the 2024 travel
 * rules (verified across PHB 2024 Ch1 L870-903 and SRD 5.2 adventuring.md).
 *
 * This is advisory only: it returns the schedule of saves a DM would call
 * for. Nothing here rolls a d20, touches `dice_rolls`, or writes
 * `characters.exhaustion_level` — that stays a manual DM action through the
 * existing `/characters/:id/exhaustion` endpoint.
 *
 * Only full hours past the threshold produce a save ("at the end of the
 * hour" — a party that stops at 8h40m has completed no forced hour). A
 * waterborne vessel is exempt (it can run up to 24 hours/day).
 */
export function forcedMarchSchedule(
  edition: TravelEdition,
  hours: number,
  mode: TravelMode,
  hoursPerDay: number = DEFAULT_TRAVEL_HOURS_PER_DAY,
): ForcedMarchSchedule {
  const none = (notes: string[]): ForcedMarchSchedule => ({
    applies: false,
    hoursBeforeExhaustionRisk: hoursPerDay,
    forcedHours: 0,
    saves: [],
    onFailure: '',
    notes,
  });

  if (edition === '2024') {
    return none(['2024: there is no forced-march rule — traveling beyond a normal day carries no saving throw and no exhaustion in the 2024 ruleset.']);
  }
  if (mode === 'waterborne') {
    return none(['A waterborne vessel can travel up to 24 hours a day (crew permitting) without forced-march saves.']);
  }
  const forcedHours = Math.max(0, Math.floor(hours) - hoursPerDay);
  if (forcedHours === 0) {
    return none([`2014: traveling ${hoursPerDay} hours or fewer carries no forced-march risk.`]);
  }

  const saves: ForcedMarchSave[] = [];
  for (let h = hoursPerDay + 1; h <= hoursPerDay + forcedHours; h += 1) {
    saves.push({ hour: h, dc: 10 + (h - hoursPerDay) });
  }

  const notes = [
    '2014: each character makes the Constitution save at the end of every full hour past the daily limit. A partial final hour triggers no save.',
  ];
  if (mode === 'land_vehicle') {
    notes.push('The SRD gives no exemption for passengers in a land vehicle — they make the same saves unless the DM rules otherwise.');
  }
  notes.push('The hour count and DC reset at the start of a new travel day; the SRD does not say a short rest resets them.');

  return {
    applies: true,
    hoursBeforeExhaustionRisk: hoursPerDay,
    forcedHours,
    saves,
    onFailure: '1 level of exhaustion (applied manually by the DM — this endpoint does not roll or record it)',
    notes,
  };
}

export interface MountedBurst {
  applies: boolean;
  /** adventuring.md: the burst lasts "about an hour". */
  burstHours: number;
  distance: Distance;
  thenRequires: string;
  notes: string[];
}

/**
 * Mounts — the "double distance for ~1 hour" burst. DIVERGES by wording:
 *  - 2014 (adventuring.md L38): "ride at a gallop for about an hour, covering
 *    twice the usual distance for a FAST pace" — i.e. 2 x 4 mi = 8 mi that
 *    hour, regardless of the party's chosen walking pace. Recovery period
 *    unspecified in 2014.
 *  - 2024 (PHB 2024 L901-903): "the group can move twice that distance for 1
 *    hour" — twice the CHOSEN pace (2 x Slow = 4 mi, not 8) — "after which the
 *    mounts need a Short or Long Rest before they can move at that increased
 *    pace again."
 *
 * Difficult terrain still halves the burst in 2014 (the halving applies to
 * "a minute, an hour, or a day" universally).
 */
export function mountedBurst(pace: Pace, edition: TravelEdition, terrain: TerrainEffect): MountedBurst {
  const basisPace: Pace = edition === '2014' ? 'fast' : pace;
  const baseMiles = TRAVEL_PACE_TABLE[basisPace].milesPerHour * 2 * terrain.multiplier;
  return {
    applies: true,
    burstHours: 1,
    distance: milesToDistance(baseMiles),
    thenRequires:
      edition === '2024'
        ? 'a Short or Long Rest for the mounts before the burst can be repeated'
        : 'rest before repeating; the 2014 rules do not specify how long (2024 defines it as a Short or Long Rest)',
    notes:
      edition === '2014'
        ? ['2014: the burst covers twice the FAST-pace distance regardless of the party’s chosen pace. Fresh mounts every 8–10 miles can sustain it, but that is rare.']
        : ['2024: the burst covers twice the chosen pace’s distance.'],
  };
}

export interface TravelPlanInput {
  edition: TravelEdition;
  pace: Pace;
  hours: number;
  terrain?: TravelTerrain;
  mode?: TravelMode;
  /** Required when mode is 'waterborne': the vessel's fixed speed in mph. */
  vesselSpeedMilesPerHour?: number;
  hoursPerDay?: number;
}

export interface TravelPlan {
  edition: TravelEdition;
  pace: Pace;
  mode: TravelMode;
  hours: number;
  hoursPerDay: number;
  /** Distance covered over `hours` at a steady pace, terrain adjustment applied. */
  distance: Distance;
  perMinute: Distance;
  perDay: { hours: number; distance: Distance };
  terrain: TerrainEffect;
  paceEffects: PaceEffects;
  forcedMarch: ForcedMarchSchedule;
  /** Present only when mode is 'mounted'. */
  mountedBurst: MountedBurst | null;
  notes: string[];
}

/**
 * The whole calculator, pure. The service layer's only job is to look up the
 * campaign's `srd_edition` and hand it in; every rule branch lives here.
 */
export function computeTravelPlan(input: TravelPlanInput): TravelPlan {
  const mode: TravelMode = input.mode ?? 'foot';
  const terrainType: TravelTerrain = input.terrain ?? 'normal';
  const hoursPerDay = input.hoursPerDay ?? DEFAULT_TRAVEL_HOURS_PER_DAY;
  const terrain = terrainEffect(terrainType, input.edition, mode);
  const notes: string[] = [];

  let distance: Distance;
  let perMinute: Distance;
  let perDay: { hours: number; distance: Distance };

  if (mode === 'waterborne') {
    const speed = input.vesselSpeedMilesPerHour ?? 0;
    distance = milesToDistance(speed * input.hours);
    perMinute = milesToDistance(speed / 60);
    perDay = { hours: 24, distance: milesToDistance(speed * 24) };
    notes.push('Waterborne: distance is the vessel’s fixed speed; the chosen pace is ignored, and a ship may run up to 24 hours a day depending on its crew.');
  } else {
    const row = TRAVEL_PACE_TABLE[input.pace];
    distance = milesToDistance(row.milesPerHour * input.hours * terrain.multiplier);
    perMinute = milesToDistance((row.feetPerMinute * terrain.multiplier) / FEET_PER_MILE);
    perDay = { hours: hoursPerDay, distance: milesToDistance(row.milesPerDay * terrain.multiplier * (hoursPerDay / DEFAULT_TRAVEL_HOURS_PER_DAY)) };
    if (hoursPerDay !== DEFAULT_TRAVEL_HOURS_PER_DAY) {
      notes.push(`Per-day distance is scaled from the ${DEFAULT_TRAVEL_HOURS_PER_DAY}-hour table figure to a ${hoursPerDay}-hour travel day.`);
    }
  }

  notes.push('The pace table assumes a Speed of 30 ft; the SRD gives no scaling for other speeds, so these figures are not adjusted for slower or faster travelers. A group typically moves at its slowest member’s rate.');

  return {
    edition: input.edition,
    pace: input.pace,
    mode,
    hours: input.hours,
    hoursPerDay,
    distance,
    perMinute,
    perDay,
    terrain,
    paceEffects: paceEffects(input.pace, input.edition, mode),
    forcedMarch: forcedMarchSchedule(input.edition, input.hours, mode, hoursPerDay),
    mountedBurst: mode === 'mounted' ? mountedBurst(input.pace, input.edition, terrain) : null,
    notes,
  };
}

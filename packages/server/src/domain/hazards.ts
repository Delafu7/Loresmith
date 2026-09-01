// docs/roadmap/dnd-2024-gap-analysis.md P3-3 (ER-08) — environmental hazards:
// Burning, Dehydration, Malnutrition, Suffocation. Scoped (confirmed with the
// user first) to STATELESS CALCULATORS plus thin advisory endpoints, the same
// shape as P3-2's domain/travelPace.ts: pure edition-branched functions here,
// no DB; the service layer resolves the campaign's `srd_edition`, calls these,
// and — for the end-of-day / suffocation resolutions — auto-writes the
// computed Exhaustion delta to characters.exhaustion_level in one transaction.
// No in-game clock is invented, no per-day food/water log is persisted; the DM
// supplies the day's inputs (how much was eaten/drunk, how many consecutive
// days without food, whether the creature can breathe again).
//
// Full rules writeup with per-line citations: docs/rules/environmental-hazards.md.
// Primary sources:
//   2024:
//     - docs/players-handbook-2024/Rules Glossary/rulesGlossary.md:431  (Burning [Hazard])
//     - docs/players-handbook-2024/Rules Glossary/rulesGlossary.md:742  (Dehydration [Hazard] + Water Needs per Day table)
//     - docs/players-handbook-2024/Rules Glossary/rulesGlossary.md:828  (Exhaustion [Condition] — cap at 6 = death)
//     - docs/players-handbook-2024/Rules Glossary/rulesGlossary.md:1170 (Malnutrition [Hazard] + Food Needs per Day table)
//     - docs/players-handbook-2024/Rules Glossary/rulesGlossary.md:1551 (Suffocation [Hazard])
//   2014:
//     - .opencode/skills/dnd5e-srd/references/2014/adventuring.md:91  (Suffocating)
//     - .opencode/skills/dnd5e-srd/references/2014/adventuring.md:131 (Food and Water)
//     - .opencode/skills/dnd5e-srd/references/2014/conditions.md:107  (Exhaustion, incl. "died at level 6")
//
// EVERY hazard diverges between the two editions (Suffocation the most —
// 2024 is Exhaustion-per-turn, 2014 drops you to 0 HP and dying), so every
// function here is edition-branched, matching P0-1 / P1-9 / P3-2's precedent
// for rules the two rulesets genuinely disagree on. Burning damage is a flat
// 1d4 Fire in both; only the way it ends and whether it's a codified generic
// hazard differ.
//
// Distances/volumes: 2024's tables are in US gallons / pounds. This app has
// no volume/weight-of-rations model, so the DM enters the day's consumption
// directly in those same units; the frontend can convert for display via
// users.unit_system exactly as it does for feet/miles elsewhere.

export type HazardEdition = '2014' | '2024';

// Lowercase to match this module's own params; the app's monster catalog
// stores capitalised size strings (services/movement.ts's sizeRankFor), and
// characters have no size column at all (they default to Medium) — the
// service normalises before calling in.
export type CreatureSize = 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'gargantuan';

export const ALL_CREATURE_SIZES: readonly CreatureSize[] = [
  'tiny',
  'small',
  'medium',
  'large',
  'huge',
  'gargantuan',
] as const;

// --------------------------------------------------------------------------
// Exhaustion (shared by every hazard that causes it)
// --------------------------------------------------------------------------

// rulesGlossary.md:832 — "This condition is cumulative. Each time you receive
// it, you gain 1 Exhaustion level. You die if your Exhaustion level is 6."
// 2014 (conditions.md:109-125) also tops out at 6 = death. So the cap is
// edition-agnostic.
export const EXHAUSTION_MAX_LEVEL = 6;

export interface ExhaustionDelta {
  before: number;
  after: number;
  /** Levels actually added after clamping to [0, 6] — can be less than the raw delta. */
  applied: number;
  /**
   * rulesGlossary.md:832 / conditions.md — at level 6 the creature is dead.
   * This module only reports it; the service deliberately does NOT flip
   * characters.is_alive (matching the existing manual updateExhaustion
   * endpoint, which also never does — see docs/rules/environmental-hazards.md
   * §5 and this phase's progress-log "Not done" note).
   */
  reachedLethalLevel: boolean;
}

export function applyExhaustionDelta(before: number, rawDelta: number): ExhaustionDelta {
  const after = Math.max(0, Math.min(EXHAUSTION_MAX_LEVEL, before + rawDelta));
  return {
    before,
    after,
    applied: after - before,
    reachedLethalLevel: after >= EXHAUSTION_MAX_LEVEL,
  };
}

// --------------------------------------------------------------------------
// Burning [Hazard]
// --------------------------------------------------------------------------

export interface BurningTick {
  /** Fire damage dice rolled at the start of each of the burning creature's turns. */
  diceCount: number;
  diceSides: number;
  damageType: 'fire';
  timing: 'start_of_turn';
  /** Human-readable list of every way the fire goes out. */
  endConditions: string[];
  notes: string[];
}

/**
 * Burning — 1d4 Fire per turn in BOTH editions; only the end conditions and
 * whether it's a codified generic hazard differ.
 *
 *  - 2024 (rulesGlossary.md:431-433): a codified "[Hazard]". "A burning
 *    creature or object takes 1d4 Fire damage at the start of each of its
 *    turns. As an action, you can extinguish fire on yourself by giving
 *    yourself the Prone condition and rolling on the ground. The fire also
 *    goes out if it is doused, submerged, or suffocated."
 *  - 2014: SRD 5.1 has NO single generic "Burning" hazard entry. Ongoing
 *    fire damage comes from a specific source (a spell, alchemist's fire, an
 *    environmental effect), each defining its own extinguish method (often a
 *    DC 10 Dexterity check as an action). This project does not independently
 *    re-verify 2014 rules text (gap-analysis "Not doing" §), so the 1d4/turn
 *    figure is carried over as the common pattern but the DM is pointed back
 *    to the triggering source's own rider.
 */
export function burningTick(edition: HazardEdition): BurningTick {
  if (edition === '2024') {
    return {
      diceCount: 1,
      diceSides: 4,
      damageType: 'fire',
      timing: 'start_of_turn',
      endConditions: [
        'As an action, the creature gives itself the Prone condition and rolls on the ground.',
        'The fire is doused, submerged, or suffocated.',
      ],
      notes: [
        '2024: Burning is a codified Hazard (rulesGlossary.md "Burning [Hazard]"). The 1d4 Fire is ordinary damage — Fire Resistance/Vulnerability/Immunity apply, handled by the normal apply-damage pipeline.',
      ],
    };
  }
  return {
    diceCount: 1,
    diceSides: 4,
    damageType: 'fire',
    timing: 'start_of_turn',
    endConditions: [
      "Per the triggering source's own text — most 2014 sources allow an action to extinguish the flames (e.g. a DC 10 Dexterity check for alchemist's fire).",
      'The fire is doused or submerged.',
    ],
    notes: [
      '2014: SRD 5.1 has no single generic "Burning" hazard. Ongoing fire damage comes from a specific spell/item/effect that defines its own damage and end condition; the 1d4 Fire/turn shown here is the common pattern, not a codified rule this project re-verifies.',
    ],
  };
}

// --------------------------------------------------------------------------
// Dehydration [Hazard]
// --------------------------------------------------------------------------

// rulesGlossary.md:748-756 — Water Needs per Day (2024), in US gallons.
export const WATER_NEEDS_GALLONS_PER_DAY: Record<CreatureSize, number> = {
  tiny: 0.25,
  small: 1,
  medium: 1,
  large: 4,
  huge: 16,
  gargantuan: 64,
};

// adventuring.md:145 — 2014 is a flat 1 gallon/day (2 if the weather is hot),
// not size-scaled.
export const WATER_NEEDS_GALLONS_2014 = 1;
export const WATER_NEEDS_GALLONS_2014_HOT = 2;

export interface DailyHazardOutcome {
  /** Exhaustion levels this hazard causes at the day's end, BEFORE clamping. */
  exhaustionLevelsGained: number;
  /** True when the result depends on a saving throw the DM must roll. */
  requiresSave: boolean;
  saveDc: number | null;
  saveAbility: 'constitution' | null;
  /** null when no save is involved; otherwise the outcome fed in. */
  saveSucceeded: boolean | null;
  requiredAmount: number;
  consumedAmount: number;
  /** rulesGlossary.md:744 / adventuring.md:133 — the removal precondition. */
  removalNote: string;
  notes: string[];
}

export interface DehydrationInput {
  edition: HazardEdition;
  /** Required for 2024 (size-scaled table); ignored for 2014. */
  size?: CreatureSize;
  gallonsConsumed: number;
  /** 2014 only — doubles the requirement (adventuring.md:145). */
  hotWeather?: boolean;
  /**
   * The creature's Exhaustion level BEFORE this day's resolution. 2014 only:
   * "If the character already has one or more levels of exhaustion, the
   * character takes two levels in either case" (adventuring.md:147).
   */
  currentExhaustionLevel?: number;
  /**
   * 2014 only — the result of the DC 15 Constitution save, when the creature
   * drank at least half but less than the full requirement. Re-derived by the
   * service from a stored dice_rolls row, never a client-asserted boolean.
   */
  saveSucceeded?: boolean;
}

export function dehydrationOutcome(input: DehydrationInput): DailyHazardOutcome {
  const consumed = Math.max(0, input.gallonsConsumed);

  if (input.edition === '2024') {
    const required = WATER_NEEDS_GALLONS_PER_DAY[input.size ?? 'medium'];
    const gained = consumed < required / 2 ? 1 : 0;
    return {
      exhaustionLevelsGained: gained,
      requiresSave: false,
      saveDc: null,
      saveAbility: null,
      saveSucceeded: null,
      requiredAmount: required,
      consumedAmount: consumed,
      removalNote:
        "Exhaustion caused by dehydration can't be removed until the creature drinks a full day's water (rulesGlossary.md:744).",
      notes:
        gained > 0
          ? ['2024: drank less than half the day\'s water — 1 Exhaustion level at day\'s end. No saving throw (a 2014-only step).']
          : ['2024: drank at least half the day\'s water — no effect.'],
    };
  }

  // 2014 (adventuring.md:143-147)
  const required = input.hotWeather ? WATER_NEEDS_GALLONS_2014_HOT : WATER_NEEDS_GALLONS_2014;
  const alreadyExhausted = (input.currentExhaustionLevel ?? 0) >= 1;
  const doublingNote = '2014: the creature already had ≥1 Exhaustion level, so a failed/automatic dehydration result costs 2 levels, not 1 (adventuring.md:147).';

  if (consumed >= required) {
    return {
      exhaustionLevelsGained: 0,
      requiresSave: false,
      saveDc: null,
      saveAbility: null,
      saveSucceeded: null,
      requiredAmount: required,
      consumedAmount: consumed,
      removalNote:
        "Exhaustion caused by lack of water can't be removed until the character drinks the full required amount (adventuring.md:133).",
      notes: ['2014: drank the full day\'s water — no effect.'],
    };
  }

  if (consumed >= required / 2) {
    // "drinks only half that much water must succeed on a DC 15 Constitution
    // saving throw or suffer one level of exhaustion at the end of the day."
    const succeeded = input.saveSucceeded ?? false;
    const base = succeeded ? 0 : 1;
    const gained = base > 0 && alreadyExhausted ? 2 : base;
    return {
      exhaustionLevelsGained: gained,
      requiresSave: true,
      saveDc: 15,
      saveAbility: 'constitution',
      saveSucceeded: succeeded,
      requiredAmount: required,
      consumedAmount: consumed,
      removalNote:
        "Exhaustion caused by lack of water can't be removed until the character drinks the full required amount (adventuring.md:133).",
      notes: [
        '2014: drank at least half but not the full requirement — DC 15 Constitution save or Exhaustion at day\'s end.',
        ...(base > 0 && alreadyExhausted ? [doublingNote] : []),
      ],
    };
  }

  // "A character with access to even less water automatically suffers one
  // level of exhaustion at the end of the day."
  const gained = alreadyExhausted ? 2 : 1;
  return {
    exhaustionLevelsGained: gained,
    requiresSave: false,
    saveDc: null,
    saveAbility: null,
    saveSucceeded: null,
    requiredAmount: required,
    consumedAmount: consumed,
    removalNote:
      "Exhaustion caused by lack of water can't be removed until the character drinks the full required amount (adventuring.md:133).",
    notes: [
      '2014: drank less than half the day\'s water — automatic Exhaustion at day\'s end, no save.',
      ...(alreadyExhausted ? [doublingNote] : []),
    ],
  };
}

// --------------------------------------------------------------------------
// Malnutrition [Hazard]
// --------------------------------------------------------------------------

// rulesGlossary.md:1176-1185 — Food Needs per Day (2024), in pounds.
export const FOOD_NEEDS_POUNDS_PER_DAY: Record<CreatureSize, number> = {
  tiny: 0.25,
  small: 1,
  medium: 1,
  large: 4,
  huge: 16,
  gargantuan: 64,
};

// adventuring.md:137 — 2014 is a flat 1 lb/day, not size-scaled.
export const FOOD_NEEDS_POUNDS_2014 = 1;

// rulesGlossary.md:1172 — "A creature that eats nothing for 5 days
// automatically gains 1 Exhaustion level at the end of the fifth day."
export const MALNUTRITION_STARVATION_DAYS_2024 = 5;

export interface MalnutritionInput {
  edition: HazardEdition;
  /** Required for 2024 (size-scaled table); ignored for 2014. */
  size?: CreatureSize;
  poundsConsumed: number;
  /**
   * Consecutive days the creature has eaten nothing at all, counting this
   * day. 2024: drives the 5-day auto-escalation. 2014: the running "days
   * without food" counter (half rations count as half a day — the DM
   * supplies the already-tallied number, which may be fractional).
   */
  consecutiveDaysWithoutFood?: number;
  /** 2014 only — Constitution modifier, for the 3 + CON-mod grace period. */
  conModifier?: number;
  /**
   * 2024 only — result of the DC 10 Constitution save, when the creature ate
   * something but less than half. Re-derived by the service from a stored
   * dice_rolls row.
   */
  saveSucceeded?: boolean;
}

export function malnutritionOutcome(input: MalnutritionInput): DailyHazardOutcome {
  const consumed = Math.max(0, input.poundsConsumed);
  const daysWithoutFood = Math.max(0, input.consecutiveDaysWithoutFood ?? 0);

  if (input.edition === '2024') {
    const required = FOOD_NEEDS_POUNDS_PER_DAY[input.size ?? 'medium'];
    const removalNote =
      "Exhaustion caused by malnutrition can't be removed until the creature eats a full day's food (rulesGlossary.md:1174).";

    if (consumed >= required / 2) {
      return {
        exhaustionLevelsGained: 0,
        requiresSave: false,
        saveDc: null,
        saveAbility: null,
        saveSucceeded: null,
        requiredAmount: required,
        consumedAmount: consumed,
        removalNote,
        notes: ['2024: ate at least half the day\'s food — no effect.'],
      };
    }

    // Two SEPARATE glossary clauses, read strictly:
    //  (a) "eats but consumes less than half ... DC 10 Con save or 1 level"
    //  (b) "eats nothing for 5 days ... automatically gains 1 level ... and
    //      an additional level at the end of each subsequent day"
    // Clause (a) presupposes eating SOMETHING; clause (b) covers eating
    // nothing. So a total-starvation day only bites once the 5-day threshold
    // is crossed, and the save clause does not also apply on a zero-food day.
    // This asymmetry (partial eating is punished from day 1, total starvation
    // only from day 5) is exactly what the two separate clauses say — flagged
    // in docs/rules/environmental-hazards.md §3 rather than "corrected".
    if (consumed === 0) {
      if (daysWithoutFood >= MALNUTRITION_STARVATION_DAYS_2024) {
        return {
          exhaustionLevelsGained: 1,
          requiresSave: false,
          saveDc: null,
          saveAbility: null,
          saveSucceeded: null,
          requiredAmount: required,
          consumedAmount: consumed,
          removalNote,
          notes: [
            `2024: ${daysWithoutFood} consecutive days without any food — automatic Exhaustion at day\'s end (rulesGlossary.md:1172), no save.`,
          ],
        };
      }
      return {
        exhaustionLevelsGained: 0,
        requiresSave: false,
        saveDc: null,
        saveAbility: null,
        saveSucceeded: null,
        requiredAmount: required,
        consumedAmount: consumed,
        removalNote,
        notes: [
          `2024: ate nothing today (day ${daysWithoutFood} of a fast). A strict reading of the two glossary clauses puts the first automatic Exhaustion at the end of the 5th consecutive day without food — no save applies on a zero-food day. See docs/rules/environmental-hazards.md §3.`,
        ],
      };
    }

    // ate something, but less than half → DC 10 Con save
    const succeeded = input.saveSucceeded ?? false;
    return {
      exhaustionLevelsGained: succeeded ? 0 : 1,
      requiresSave: true,
      saveDc: 10,
      saveAbility: 'constitution',
      saveSucceeded: succeeded,
      requiredAmount: required,
      consumedAmount: consumed,
      removalNote,
      notes: ['2024: ate something but less than half the day\'s food — DC 10 Constitution save or Exhaustion at day\'s end.'],
    };
  }

  // 2014 (adventuring.md:137-141)
  const grace = Math.max(1, 3 + (input.conModifier ?? 0));
  const removalNote =
    "Exhaustion caused by lack of food can't be removed until the character eats the full required amount (adventuring.md:133).";
  // "At the end of each day beyond that limit, a character automatically
  // suffers one level of exhaustion." Strictly greater than the grace period.
  const gained = daysWithoutFood > grace ? 1 : 0;
  return {
    exhaustionLevelsGained: gained,
    requiresSave: false,
    saveDc: null,
    saveAbility: null,
    saveSucceeded: null,
    requiredAmount: FOOD_NEEDS_POUNDS_2014,
    consumedAmount: consumed,
    removalNote,
    notes:
      gained > 0
        ? [`2014: ${daysWithoutFood} days without food exceeds the ${grace}-day grace period (3 + CON mod, min 1) — automatic Exhaustion, no save. A normal day of eating resets the count.`]
        : [`2014: ${daysWithoutFood} days without food is within the ${grace}-day grace period (3 + CON mod, min 1) — no effect yet. Half rations count as half a day without food.`],
  };
}

// --------------------------------------------------------------------------
// Suffocation [Hazard]
// --------------------------------------------------------------------------

export interface SuffocationOutcome {
  edition: HazardEdition;
  /** rulesGlossary.md:1551 — 1 + CON mod minutes, minimum 30 seconds. */
  breathHoldMinutes: number;
  breathHoldSecondsFloor: 30;
  /**
   * 2024: 1 Exhaustion level at the END OF EACH TURN once out of breath.
   * 2014: 0 — 2014 has no Exhaustion interaction for suffocation.
   */
  exhaustionPerTurn: number;
  /** 2024 only — rulesGlossary.md:1553: breathing again removes ALL suffocation Exhaustion. */
  removesAllSuffocationExhaustionOnBreathing: boolean;
  /**
   * 2014 only — adventuring.md:95: after breath runs out the creature
   * survives `max(1, CON mod)` rounds, then at the start of its next turn
   * drops to 0 HP and is dying (can't regain HP or be stabilised until it
   * can breathe). null for 2024.
   */
  roundsBeforeDropTo0Hp: number | null;
  notes: string[];
}

export interface SuffocationInput {
  edition: HazardEdition;
  conModifier: number;
}

export function suffocationOutcome(input: SuffocationInput): SuffocationOutcome {
  // 1 + CON mod minutes, "minimum of 30 seconds" — so a CON mod of 0 gives
  // 1 minute, -1 gives 30s (not 0), -3 gives 30s (not negative).
  const rawMinutes = 1 + input.conModifier;
  const breathHoldMinutes = Math.max(0.5, rawMinutes);

  if (input.edition === '2024') {
    return {
      edition: '2024',
      breathHoldMinutes,
      breathHoldSecondsFloor: 30,
      exhaustionPerTurn: 1,
      removesAllSuffocationExhaustionOnBreathing: true,
      roundsBeforeDropTo0Hp: null,
      notes: [
        '2024 (rulesGlossary.md:1551): once out of breath or choking, the creature gains 1 Exhaustion level at the end of each of its turns. When it can breathe again, it removes ALL Exhaustion levels it gained from suffocating (but not from other sources).',
      ],
    };
  }

  return {
    edition: '2014',
    breathHoldMinutes,
    breathHoldSecondsFloor: 30,
    exhaustionPerTurn: 0,
    removesAllSuffocationExhaustionOnBreathing: false,
    roundsBeforeDropTo0Hp: Math.max(1, input.conModifier),
    notes: [
      `2014 (adventuring.md:91-97): once out of breath the creature survives ${Math.max(1, input.conModifier)} round(s) (max(1, CON mod)), then at the start of its next turn drops to 0 HP and is dying — it can't regain HP or be stabilised until it can breathe again. 2014 suffocation causes NO Exhaustion.`,
    ],
  };
}

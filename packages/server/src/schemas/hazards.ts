import { z } from 'zod';

// docs/roadmap/dnd-2024-gap-analysis.md P3-3 (ER-08) — request schemas for the
// environmental-hazard endpoints. See domain/hazards.ts for the rule branches
// and docs/rules/environmental-hazards.md for the full writeup. Scoped
// (confirmed with the user) to stateless calculators + advisory endpoints that
// auto-write the computed Exhaustion delta; nothing here persists a per-day
// food/water log or invents an in-game clock.

export const CREATURE_SIZES = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'] as const;

// POST /encounters/:id/participants/:pid/burning-tick — no body. The 1d4 Fire
// is applied through the normal apply-damage pipeline (Fire Resistance etc.
// handled there); the endpoint only needs the participant from the URL.
export const burningTickSchema = z.object({}).strict();
export type BurningTickInput = z.infer<typeof burningTickSchema>;

// POST /encounters/:id/participants/:pid/suffocation-tick
export const suffocationTickSchema = z.object({
  // false = resolve one turn out of breath (2024: +1 Exhaustion; 2014:
  // report-only). true = the creature can breathe again (2024: remove all
  // Exhaustion it accrued from THIS suffocation episode, tracked on the
  // "Suffocating" effect's stack_count).
  canBreatheAgain: z.boolean(),
});
export type SuffocationTickInput = z.infer<typeof suffocationTickSchema>;

// POST /campaigns/:id/hazards/resolve-daily — end-of-day Dehydration +
// Malnutrition resolution for one or more characters. DM-only. The server
// pulls each character's Constitution and current Exhaustion level itself
// (for the 2014 grace period / the 2014 "already exhausted doubles it" rule);
// the DM only supplies the day's consumption and, where a save is called for,
// the id of a Constitution save it already rolled via the dice endpoint.
const dailyWaterSchema = z.object({
  gallonsConsumed: z.number().min(0).max(1000),
  // 2014 only — hot weather doubles the requirement (adventuring.md:145).
  hotWeather: z.boolean().optional(),
  // 2014 only — the DC 15 Constitution save rolled when the creature drank at
  // least half but not the full requirement. Re-derived from the stored row
  // (roll_type = 'saving_throw'); a missing/foreign id counts as a failed
  // save, same precedent as P1-12's half-on-save.
  saveRollId: z.string().uuid().optional(),
});

const dailyFoodSchema = z.object({
  poundsConsumed: z.number().min(0).max(1000),
  // Consecutive days the creature has eaten nothing, counting today. 2024:
  // drives the 5-day starvation auto-escalation. 2014: the running "days
  // without food" tally (half rations = half a day — DM supplies the number,
  // which may be fractional). Defaults to 0 (well fed until now).
  consecutiveDaysWithoutFood: z.number().min(0).max(3650).optional(),
  // 2024 only — the DC 10 Constitution save rolled when the creature ate
  // something but less than half.
  saveRollId: z.string().uuid().optional(),
});

export const resolveDailyHazardsSchema = z.object({
  entries: z
    .array(
      z
        .object({
          characterId: z.string().uuid(),
          // Characters have no size column (they default to Medium); the DM
          // overrides here for a non-Medium PC or a size-changed creature.
          // Ignored in 2014 (that edition's food/water needs aren't
          // size-scaled).
          size: z.enum(CREATURE_SIZES).optional(),
          water: dailyWaterSchema.optional(),
          food: dailyFoodSchema.optional(),
        })
        .refine((e) => e.water !== undefined || e.food !== undefined, {
          message: 'each entry must include at least one of water or food',
        }),
    )
    .min(1)
    .max(50),
});
export type ResolveDailyHazardsInput = z.infer<typeof resolveDailyHazardsSchema>;

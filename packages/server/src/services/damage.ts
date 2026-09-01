// Damage resolution — resistance/vulnerability/immunity, critical-hit dice
// doubling (REFACTOR-PLAN.md §6). Pure function, no DB/Express dependency,
// matching this codebase's existing pure-function-first precedent
// (services/hp.ts, services/movement.ts). Runs BEFORE
// applyHpDeltaWithTempAbsorption (services/hp.ts) — a distinct, composable
// step, not a replacement for it.
//
// Grounded in docs/rules/attacks-and-damage.md — consult that file for the
// full SRD citations this implements. Key ordering fact this function
// depends on the CALLER getting right (see routes/services calling this):
// critical-hit dice doubling is a DICE-ROLLING-TIME concern (roll the dice
// twice), not something this function does — it receives `rolledDiceTotal`
// already reflecting the doubled dice when isCritical is true.

export interface DamageTarget {
  /** Damage-type names, lowercase, matching the 13-type SRD catalog. */
  resistances: string[];
  vulnerabilities: string[];
  immunities: string[];
}

export interface RawDamageInput {
  /** Sum of the dice portion only (already doubled by the caller if this was
   * a critical hit) — kept separate from `modifier` because crit doubling
   * only ever affects dice, never the flat modifier (docs/rules/
   * attacks-and-damage.md §1.2). */
  rolledDiceTotal: number;
  modifier: number;
  /** null = untyped damage — never resisted/vulnerable/immune, since there's
   * no type to match against a target's arrays. */
  damageType: string | null;
  isCritical: boolean;
  /** docs/roadmap/dnd-2024-gap-analysis.md P1-12 — true when the target's
   * saving throw succeeded against this effect's DC (the caller derives this
   * server-side from the actual stored dice_rolls row, never from a
   * client-asserted boolean — see diceRolls.ts's deriveSaveOutcomeSucceeded).
   * Undefined/false = no save involved, or the save failed — full damage. */
  savingThrowSucceeded?: boolean;
  /** Mirrors character_attacks.half_on_save / statBlockEntrySchema's field —
   * whether a successful save halves damage (the common case) vs. negates it
   * entirely. Ignored unless savingThrowSucceeded is true. */
  halfOnSave?: boolean;
}

export interface AppliedDamageResult {
  rawTotal: number;
  appliedDamage: number;
  breakdown: {
    diceTotal: number;
    modifier: number;
    resistanceApplied: boolean;
    vulnerabilityApplied: boolean;
    immune: boolean;
    savedHalved: boolean;
    savedNegated: boolean;
  };
}

// docs/roadmap/dnd-2024-gap-analysis.md P3-1 (ER-06) — Falling.
// rulesGlossary.md line 858-860 ("Falling [Hazard]"): "1d6 Bludgeoning
// damage at the end of the fall for every 10 feet it fell, to a maximum of
// 20d6." Confirmed identical in 2014 (.opencode/skills/dnd5e-srd/references/
// 2014/adventuring.md's own "Falling" section: "1d6 bludgeoning damage for
// every 3 meters it fell, to a maximum of 20d6") — no edition branch needed.
// A fall under 10 ft deals 0 dice (floor division), matching RAW.
export function computeFallDamageDiceCount(distanceFt: number): number {
  return Math.min(20, Math.floor(Math.max(0, distanceFt) / 10));
}

export function computeAppliedDamage(raw: RawDamageInput, target: DamageTarget): AppliedDamageResult {
  const rawTotal = Math.max(0, raw.rolledDiceTotal + raw.modifier);

  // docs/rules/attacks-and-damage.md §1.7/§3 edge case 7 — a successful save
  // halves (round down) or negates the damage BEFORE type-based effects
  // apply, on the pre-resistance raw total; resistance/vulnerability then
  // apply to that already-halved-or-zeroed number, never the other way
  // around.
  const savedNegated = raw.savingThrowSucceeded === true && raw.halfOnSave === false;
  const savedHalved = raw.savingThrowSucceeded === true && raw.halfOnSave !== false;
  const preTypeTotal = savedNegated ? 0 : savedHalved ? Math.floor(rawTotal / 2) : rawTotal;

  if (raw.damageType === null) {
    return {
      rawTotal,
      appliedDamage: preTypeTotal,
      breakdown: {
        diceTotal: raw.rolledDiceTotal, modifier: raw.modifier, resistanceApplied: false, vulnerabilityApplied: false,
        immune: false, savedHalved, savedNegated,
      },
    };
  }

  const type = raw.damageType.toLowerCase();

  // Immunity wins regardless of what else is also (erroneously/homebrew)
  // present — "no effect from it at all" is unconditional, not "unless also
  // vulnerable" (docs/rules/attacks-and-damage.md §3 edge case 2).
  if (target.immunities.includes(type)) {
    return {
      rawTotal,
      appliedDamage: 0,
      breakdown: {
        diceTotal: raw.rolledDiceTotal, modifier: raw.modifier, resistanceApplied: false, vulnerabilityApplied: false,
        immune: true, savedHalved, savedNegated,
      },
    };
  }

  const resistanceApplied = target.resistances.includes(type);
  const vulnerabilityApplied = target.vulnerabilities.includes(type);

  // Order matters — resistance THEN vulnerability, per both editions'
  // explicit ordering text (§1.3/§1.4). Multiple sources of the SAME
  // resistance/vulnerability never stack past one application — that's
  // already guaranteed here since `resistances`/`vulnerabilities` are
  // checked with `.includes`, not counted.
  let applied = preTypeTotal;
  if (resistanceApplied) applied = Math.floor(applied / 2);
  if (vulnerabilityApplied) applied = applied * 2;

  return {
    rawTotal,
    appliedDamage: Math.max(0, applied),
    breakdown: {
      diceTotal: raw.rolledDiceTotal, modifier: raw.modifier, resistanceApplied, vulnerabilityApplied,
      immune: false, savedHalved, savedNegated,
    },
  };
}

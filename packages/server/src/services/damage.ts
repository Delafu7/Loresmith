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
  };
}

export function computeAppliedDamage(raw: RawDamageInput, target: DamageTarget): AppliedDamageResult {
  const rawTotal = Math.max(0, raw.rolledDiceTotal + raw.modifier);

  if (raw.damageType === null) {
    return {
      rawTotal,
      appliedDamage: rawTotal,
      breakdown: { diceTotal: raw.rolledDiceTotal, modifier: raw.modifier, resistanceApplied: false, vulnerabilityApplied: false, immune: false },
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
      breakdown: { diceTotal: raw.rolledDiceTotal, modifier: raw.modifier, resistanceApplied: false, vulnerabilityApplied: false, immune: true },
    };
  }

  const resistanceApplied = target.resistances.includes(type);
  const vulnerabilityApplied = target.vulnerabilities.includes(type);

  // Order matters — resistance THEN vulnerability, per both editions'
  // explicit ordering text (§1.3/§1.4). Multiple sources of the SAME
  // resistance/vulnerability never stack past one application — that's
  // already guaranteed here since `resistances`/`vulnerabilities` are
  // checked with `.includes`, not counted.
  let applied = rawTotal;
  if (resistanceApplied) applied = Math.floor(applied / 2);
  if (vulnerabilityApplied) applied = applied * 2;

  return {
    rawTotal,
    appliedDamage: Math.max(0, applied),
    breakdown: { diceTotal: raw.rolledDiceTotal, modifier: raw.modifier, resistanceApplied, vulnerabilityApplied, immune: false },
  };
}

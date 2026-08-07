// Iteration 3 dice-engine rebuild — pure, unit-tested primitives extracted
// from what used to be scattered, duplicated math across services/
// characters.ts's/monsters.ts's applyDamage (crit doubling) and nowhere at
// all for several formulas services/diceRolls.ts's rollDice needs but never
// had a home for (advantage/disadvantage collapse, save DC, proficiency
// bonus). Grounded against docs/rules/dice-mechanics.md — every formula
// below cites the section number of its worked examples/edge cases there,
// rather than re-deriving the citation chain inline.
//
// Every function here is a pure, already-rolled-dice-in / value-out
// primitive — none of them call rollDie themselves except
// rerollOnceIfMatches (2014 Great Weapon Fighting / Lucky's actual reroll),
// which is the one primitive that's inherently about triggering a NEW roll,
// not just evaluating already-rolled numbers. Trait/feature eligibility
// (does this character have GWF, is this a d20 test) is always a
// caller-supplied input, never looked up internally — see
// dice-mechanics.md §3.2's "no character-feature-choice table exists yet"
// finding; this engine stays trait-agnostic on purpose.

import { rollDie } from './diceRolls.js';

// §1 — critical hit dice-doubling. Only the dice portion ever doubles; the
// flat modifier is always added once by the caller, never touched here.
export function criticalDiceCount(diceCount: number, isCritical: boolean): number {
  return isCritical ? diceCount * 2 : diceCount;
}

// §2 — advantage/disadvantage source-count collapse. Source COUNTS never
// matter past "zero or more than zero" — 3 advantage sources + 1
// disadvantage source still cancels to 'normal', never "advantage wins."
export function resolveAdvantage(
  advantageSourceCount: number,
  disadvantageSourceCount: number,
): 'normal' | 'advantage' | 'disadvantage' {
  const hasAdvantage = advantageSourceCount > 0;
  const hasDisadvantage = disadvantageSourceCount > 0;
  if (hasAdvantage && hasDisadvantage) return 'normal';
  if (hasAdvantage) return 'advantage';
  if (hasDisadvantage) return 'disadvantage';
  return 'normal';
}

// §3 — 2014 Great Weapon Fighting / Halfling Lucky shape: reroll a die
// exactly once if it matches the trigger, unconditionally keep the new
// value even if it ALSO matches (never a while-loop — that would be a
// fabricated rule with no SRD basis, see §3.3's edge-case note).
export interface RerollResult {
  finalValue: number;
  wasRerolled: boolean;
}

export function rerollOnceIfMatches(
  originalRoll: number,
  triggerPredicate: (roll: number) => boolean,
  sides: number,
): RerollResult {
  if (!triggerPredicate(originalRoll)) return { finalValue: originalRoll, wasRerolled: false };
  return { finalValue: rollDie(sides), wasRerolled: true };
}

// §3/§4 — 2024 Great Weapon Fighting shape: deterministic floor, never an
// extra roll. Never lowers a die already at or above the floor.
export function clampDieMinimum(roll: number, floor: number): number {
  return Math.max(roll, floor);
}

// §5 — saving throw / spell / monster-action DC. Deliberately NOT wired
// into any schema as a server-enforced value — this app's existing
// convention (schemas/characterAttacks.ts, schemas/monsterCatalog.ts,
// schemas/effects.ts, schemas/casting.ts) always stores saveDc as a
// manually-entered flat integer; this is a suggest-a-value helper for the
// frontend to call while a player/DM fills that field in, never an
// authoritative recompute.
export function computeSaveDc(proficiencyBonus: number, abilityModifier: number, specialModifiers = 0): number {
  return 8 + proficiencyBonus + abilityModifier + specialModifiers;
}

// §5 — proficiency bonus by TOTAL character level (summed across every
// class for a multiclass character, never a single class's level column —
// see dice-mechanics.md §5.2/§5.3's explicit warning about this exact bug).
// Confirmed gap this closes: this formula previously existed only
// client-side (packages/web/src/lib/dnd-math.ts) with no server
// equivalent — kept byte-for-byte identical to that copy on purpose (see
// this repo's own dnd-math.ts comment), since nothing in this monorepo
// currently lets the two runtimes share one module for it.
export function proficiencyBonusForLevel(level: number): number {
  return 2 + Math.floor((Math.max(1, level) - 1) / 4);
}

// §6 — passive score (passive Perception, Investigation, etc.), generalized
// beyond Perception specifically per the SRD's general "Passive Checks"
// framing. Expertise doubles only the proficiency-bonus TERM, never the
// whole sum; advantage/disadvantage cancel via the same source-count
// collapse as §2, never independently re-derived here.
export function computePassiveScore(
  abilityModifier: number,
  proficiencyBonus: number,
  proficiencyLevel: 'none' | 'proficient' | 'expertise',
  hasAdvantage: boolean,
  hasDisadvantage: boolean,
): number {
  const profTerm =
    proficiencyLevel === 'expertise' ? proficiencyBonus * 2 : proficiencyLevel === 'proficient' ? proficiencyBonus : 0;
  const advTerm = hasAdvantage && !hasDisadvantage ? 5 : !hasAdvantage && hasDisadvantage ? -5 : 0;
  return 10 + abilityModifier + profTerm + advTerm;
}

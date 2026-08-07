// Pure D&D calculation helpers, kept out of components so they stay
// unit-testable in isolation (per the task brief: "keep any pure calculation
// out of components where reasonable").

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function formatModifier(mod: number): string {
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

/** 2014/2024 proficiency bonus by total character level (shared table both editions use). */
export function proficiencyBonusForLevel(level: number): number {
  return 2 + Math.floor((Math.max(1, level) - 1) / 4);
}

export function skillModifier(
  abilityScore: number,
  proficiencyBonus: number,
  level: 'none' | 'proficient' | 'expertise',
): number {
  const base = abilityModifier(abilityScore);
  if (level === 'proficient') return base + proficiencyBonus;
  if (level === 'expertise') return base + proficiencyBonus * 2;
  return base;
}

export function passivePerception(wisModifier: number, perceptionSkillMod: number | null): number {
  return 10 + (perceptionSkillMod ?? wisModifier);
}

// Iteration 3 dice-engine rebuild (docs/rules/dice-mechanics.md §5) — a
// suggest-a-value helper, never server-enforced: every saveDc field in this
// app's schema (character_attacks, monster catalog actions, effects,
// casting) is a manually-entered flat integer, matching this app's existing
// "player/DM enters their own pre-computed stat block values" convention.
// Kept byte-for-byte identical to packages/server/src/services/
// diceEngine.ts's copy — this monorepo has no shared package the two
// runtimes both import from, so the two copies are synced by hand; a test
// fixture in each package's test suite runs the same worked examples to
// catch drift.
export function computeSaveDc(proficiencyBonus: number, abilityModifier: number, specialModifiers = 0): number {
  return 8 + proficiencyBonus + abilityModifier + specialModifiers;
}

// Generalizes passivePerception above beyond Perception specifically (the
// SRD's "Passive Checks" framing applies to any skill, not just Perception)
// and closes a confirmed gap passivePerception has no way to close: it
// takes no advantage/disadvantage parameter, so it can only ever compute
// the "neither" case, never the SRD's documented ±5 adjustment. Expertise
// doubles only the proficiency-bonus TERM, never the whole sum. Kept in
// sync with services/diceEngine.ts's copy, same reasoning as computeSaveDc
// above.
export function computePassiveScore(
  abilityMod: number,
  proficiencyBonus: number,
  proficiencyLevel: 'none' | 'proficient' | 'expertise',
  hasAdvantage: boolean,
  hasDisadvantage: boolean,
): number {
  const profTerm =
    proficiencyLevel === 'expertise' ? proficiencyBonus * 2 : proficiencyLevel === 'proficient' ? proficiencyBonus : 0;
  const advTerm = hasAdvantage && !hasDisadvantage ? 5 : !hasAdvantage && hasDisadvantage ? -5 : 0;
  return 10 + abilityMod + profTerm + advTerm;
}

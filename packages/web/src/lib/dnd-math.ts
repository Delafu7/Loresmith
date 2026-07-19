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

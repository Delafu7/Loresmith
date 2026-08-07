import { describe, expect, it } from 'vitest';
import {
  abilityModifier,
  computePassiveScore,
  computeSaveDc,
  formatModifier,
  passivePerception,
  proficiencyBonusForLevel,
  skillModifier,
} from './dnd-math';

describe('abilityModifier', () => {
  it.each([
    [1, -5],
    [8, -1],
    [9, -1],
    [10, 0],
    [11, 0],
    [12, 1],
    [15, 2],
    [16, 3],
    [20, 5],
  ])('score %i -> modifier %i', (score, expected) => {
    expect(abilityModifier(score)).toBe(expected);
  });
});

describe('formatModifier', () => {
  it('prefixes non-negative modifiers with +', () => {
    expect(formatModifier(3)).toBe('+3');
    expect(formatModifier(0)).toBe('+0');
  });
  it('leaves negative modifiers as-is', () => {
    expect(formatModifier(-2)).toBe('-2');
  });
});

describe('proficiencyBonusForLevel', () => {
  it.each([
    [1, 2],
    [4, 2],
    [5, 3],
    [8, 3],
    [9, 4],
    [12, 4],
    [13, 5],
    [16, 5],
    [17, 6],
    [20, 6],
  ])('level %i -> proficiency bonus %i', (level, expected) => {
    expect(proficiencyBonusForLevel(level)).toBe(expected);
  });
});

describe('skillModifier', () => {
  it('not proficient: just the ability modifier', () => {
    expect(skillModifier(16, 2, 'none')).toBe(3);
  });
  it('proficient: ability modifier + proficiency bonus once', () => {
    expect(skillModifier(16, 2, 'proficient')).toBe(5);
  });
  it('expertise: ability modifier + proficiency bonus doubled', () => {
    expect(skillModifier(16, 2, 'expertise')).toBe(7);
  });
});

describe('passivePerception', () => {
  it('uses the actual Perception skill modifier when known', () => {
    expect(passivePerception(1, 5)).toBe(15);
  });
  it('falls back to the raw WIS modifier when no Perception skill mod is given', () => {
    expect(passivePerception(3, null)).toBe(13);
  });
});

// docs/rules/dice-mechanics.md §5.4 worked examples.
describe('computeSaveDc', () => {
  it('level-1 cleric worked example: 8 + 2 + 3 = 13', () => {
    expect(computeSaveDc(2, 3)).toBe(13);
  });
  it('level-9 cleric worked example: 8 + 4 + 4 = 16', () => {
    expect(computeSaveDc(4, 4)).toBe(16);
  });
  it('level-17 cleric worked example: 8 + 6 + 5 = 19', () => {
    expect(computeSaveDc(6, 5)).toBe(19);
  });
  it('accepts an explicit special-modifiers term', () => {
    expect(computeSaveDc(2, 3, 1)).toBe(14);
  });
});

// docs/rules/dice-mechanics.md §6.4 worked examples — closes the confirmed
// gap passivePerception has no way to close (no advantage/disadvantage
// parameter at all).
describe('computePassiveScore', () => {
  it('the exact 2014-quoted worked example: WIS 15 (+2), level-1 prof bonus +2, proficient -> 14', () => {
    expect(computePassiveScore(2, 2, 'proficient', false, false)).toBe(14);
  });
  it('same character with advantage -> +5', () => {
    expect(computePassiveScore(2, 2, 'proficient', true, false)).toBe(19);
  });
  it('same character with disadvantage -> -5', () => {
    expect(computePassiveScore(2, 2, 'proficient', false, true)).toBe(9);
  });
  it('advantage and disadvantage cancel — regression test for "always add if hasAdvantage"', () => {
    expect(computePassiveScore(2, 2, 'proficient', true, true)).toBe(14);
  });
  it('non-proficient, negative ability modifier (passive Investigation example)', () => {
    expect(computePassiveScore(-1, 2, 'none', false, false)).toBe(9);
  });
  it('expertise doubles only the proficiency-bonus TERM, not the whole sum', () => {
    expect(computePassiveScore(2, 2, 'expertise', false, false)).toBe(16); // 10 + 2 + (2*2)
    expect(computePassiveScore(2, 2, 'expertise', false, false)).not.toBe(28); // not (10+2+2)*2
  });
  it('agrees with skillModifier(...) + 10 for the no-advantage/no-disadvantage case, so the two never silently diverge', () => {
    const abilityScore = 16; // modifier +3
    const proficiencyBonus = 3;
    for (const level of ['none', 'proficient', 'expertise'] as const) {
      const mod = abilityModifier(abilityScore);
      expect(computePassiveScore(mod, proficiencyBonus, level, false, false)).toBe(
        skillModifier(abilityScore, proficiencyBonus, level) + 10,
      );
    }
  });
});

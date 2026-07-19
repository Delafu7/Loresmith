import { describe, expect, it } from 'vitest';
import {
  abilityModifier,
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

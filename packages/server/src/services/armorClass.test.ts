import { describe, expect, it } from 'vitest';
import { abilityModifier, computeArmorClass } from './armorClass.js';

describe('abilityModifier', () => {
  it('follows the standard SRD floor((score-10)/2) table', () => {
    expect(abilityModifier(10)).toBe(0);
    expect(abilityModifier(11)).toBe(0);
    expect(abilityModifier(8)).toBe(-1);
    expect(abilityModifier(20)).toBe(5);
    expect(abilityModifier(15)).toBe(2);
  });
});

describe('computeArmorClass', () => {
  it('unarmored is 10 + Dex modifier', () => {
    expect(computeArmorClass(14, null, false)).toBe(12);
  });

  it('unarmored with a negative Dex modifier', () => {
    expect(computeArmorClass(8, null, false)).toBe(9);
  });

  it('light armor (full Dex) adds the whole Dex modifier on top of the base', () => {
    // Leather Armor: base 11, dex_modifier_rule='full'
    expect(computeArmorClass(16, { armor_class_base: 11, dex_modifier_rule: 'full' }, false)).toBe(14);
  });

  it('medium armor (max_2) caps the Dex contribution at +2 even with a higher modifier', () => {
    // Scale Mail: base 14, dex_modifier_rule='max_2', Dex 18 -> +4 mod, capped to +2
    expect(computeArmorClass(18, { armor_class_base: 14, dex_modifier_rule: 'max_2' }, false)).toBe(16);
  });

  it('medium armor (max_2) still applies the full modifier when it is below the cap', () => {
    // Dex 12 -> +1 mod, below the +2 cap, so nothing is clamped
    expect(computeArmorClass(12, { armor_class_base: 14, dex_modifier_rule: 'max_2' }, false)).toBe(15);
  });

  it('heavy armor (none) ignores Dex entirely, including a positive modifier', () => {
    // Chain Mail: base 16, dex_modifier_rule='none'
    expect(computeArmorClass(18, { armor_class_base: 16, dex_modifier_rule: 'none' }, false)).toBe(16);
  });

  it('a shield adds a flat +2 on top of unarmored AC', () => {
    expect(computeArmorClass(14, null, true)).toBe(14);
  });

  it('a shield adds a flat +2 additively on top of worn armor, not a replacement', () => {
    // Chain Mail (16, no Dex) + Shield (+2) = 18
    expect(computeArmorClass(14, { armor_class_base: 16, dex_modifier_rule: 'none' }, true)).toBe(18);
  });

  it('light armor + shield + a capped-irrelevant high Dex all combine correctly', () => {
    // Studded Leather: base 12, full Dex; Dex 20 -> +5 mod; + shield +2
    expect(computeArmorClass(20, { armor_class_base: 12, dex_modifier_rule: 'full' }, true)).toBe(19);
  });
});

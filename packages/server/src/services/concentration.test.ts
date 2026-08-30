import { describe, expect, it } from 'vitest';
import { computeConcentrationDc } from './concentration.js';

describe('computeConcentrationDc', () => {
  it('is half the damage, rounded down', () => {
    expect(computeConcentrationDc(20)).toBe(10);
    expect(computeConcentrationDc(21)).toBe(10);
    expect(computeConcentrationDc(22)).toBe(11);
  });

  it('is never below the SRD floor of 10, even for tiny damage', () => {
    expect(computeConcentrationDc(1)).toBe(10);
    expect(computeConcentrationDc(0)).toBe(10);
  });

  // Rules Glossary "Concentration" (docs/players-handbook-2024/Rules Glossary/
  // rulesGlossary.md:515): DC caps at 30 no matter how much damage is taken.
  it('is capped at the SRD maximum of 30, even for massive damage', () => {
    expect(computeConcentrationDc(60)).toBe(30); // last value the uncapped formula also gives 30 for
    expect(computeConcentrationDc(62)).toBe(30); // uncapped formula would give 31 here
    expect(computeConcentrationDc(100)).toBe(30); // uncapped formula would give 50 here
  });
});

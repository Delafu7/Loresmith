import { describe, expect, it } from 'vitest';
import { computeHitDiceRestore } from './rests.js';

// 2024: docs/players-handbook-2024/Rules Glossary/rulesGlossary.md:1135,
// "Long Rest" § Benefits of the Rest — "You regain all lost Hit Points and
// all spent Hit Point Dice."
describe('computeHitDiceRestore (2024 edition)', () => {
  it('restores ALL spent hit dice, not half', () => {
    // Kessia Duskbane: Paladin 3 (d10) + Warlock 2 (d8) -> 5 total hit dice,
    // all 5 restored under 2024 rules (would be floor(5/2)=2 under the old,
    // 2014-only formula).
    const { hitDiceRemaining, restoredCount } = computeHitDiceRestore(
      [
        { dieType: 'd10', maxForType: 3 },
        { dieType: 'd8', maxForType: 2 },
      ],
      { d10: 0, d8: 0 },
      '2024',
    );
    expect(restoredCount).toBe(5);
    expect(hitDiceRemaining).toEqual({ d10: 3, d8: 2 });
  });

  it('never exceeds each die type max, spilling overflow into the next-largest type', () => {
    const { hitDiceRemaining, restoredCount } = computeHitDiceRestore(
      [
        { dieType: 'd10', maxForType: 1 },
        { dieType: 'd8', maxForType: 2 },
      ],
      { d10: 1, d8: 1 },
      '2024',
    );
    // 1 spent die (d8) remains to restore; d10 already full, so it stays put.
    expect(restoredCount).toBe(1);
    expect(hitDiceRemaining).toEqual({ d10: 1, d8: 2 });
  });

  it('caps restoration at total remaining capacity across all types', () => {
    const { hitDiceRemaining, restoredCount } = computeHitDiceRestore(
      [{ dieType: 'd8', maxForType: 4 }],
      { d8: 4 },
      '2024',
    );
    expect(restoredCount).toBe(0);
    expect(hitDiceRemaining).toEqual({ d8: 4 });
  });

  it('produces no restoration for a character with no classes/hit dice', () => {
    const { restoredCount } = computeHitDiceRestore([], {}, '2024');
    expect(restoredCount).toBe(0);
  });
});

// 2014 formula kept for campaigns still running that edition (Open Question 2
// in docs/roadmap/dnd-2024-gap-analysis.md) — restores only half of total hit
// dice, minimum 1.
describe('computeHitDiceRestore (2014 edition)', () => {
  it('restores half (rounded down) of total hit dice, minimum 1', () => {
    const { hitDiceRemaining, restoredCount } = computeHitDiceRestore(
      [
        { dieType: 'd10', maxForType: 3 },
        { dieType: 'd8', maxForType: 2 },
      ],
      { d10: 0, d8: 0 },
      '2014',
    );
    expect(restoredCount).toBe(2);
    // Largest die type first: both restored dice go to d10 (capacity 3, need 2).
    expect(hitDiceRemaining).toEqual({ d10: 2, d8: 0 });
  });

  it('restores a minimum of 1 even when half rounds down to 0', () => {
    const { restoredCount } = computeHitDiceRestore([{ dieType: 'd8', maxForType: 1 }], { d8: 0 }, '2014');
    expect(restoredCount).toBe(1);
  });

  it('never exceeds each die type max, spilling overflow into the next-largest type', () => {
    // 3 total hit dice (d10 x1 already full, d8 x2) -> restore floor(3/2)=1,
    // but d10 has no remaining capacity, so it should spill to d8.
    const { hitDiceRemaining, restoredCount } = computeHitDiceRestore(
      [
        { dieType: 'd10', maxForType: 1 },
        { dieType: 'd8', maxForType: 2 },
      ],
      { d10: 1, d8: 0 },
      '2014',
    );
    expect(restoredCount).toBe(1);
    expect(hitDiceRemaining).toEqual({ d10: 1, d8: 1 });
  });

  it('caps restoration at total remaining capacity across all types', () => {
    const { hitDiceRemaining, restoredCount } = computeHitDiceRestore(
      [{ dieType: 'd8', maxForType: 4 }],
      { d8: 4 },
      '2014',
    );
    // Already fully rested — nothing to restore even though floor(4/2)=2 "should" apply.
    expect(restoredCount).toBe(0);
    expect(hitDiceRemaining).toEqual({ d8: 4 });
  });

  it('produces no restoration for a character with no classes/hit dice', () => {
    const { restoredCount } = computeHitDiceRestore([], {}, '2014');
    expect(restoredCount).toBe(0);
  });
});

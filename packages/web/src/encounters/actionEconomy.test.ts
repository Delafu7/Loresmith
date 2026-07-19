import { describe, expect, it } from 'vitest';
import { highJumpDistanceFt, jumpDistanceFt, standUpCostFt } from './actionEconomy';

describe('jumpDistanceFt (long jump)', () => {
  it('running start: full STR score', () => {
    expect(jumpDistanceFt(16, true)).toBe(16);
  });
  it('standing (no running start): half STR score, rounded down', () => {
    expect(jumpDistanceFt(15, false)).toBe(7);
  });
});

describe('highJumpDistanceFt', () => {
  it('running start: 3 + STR modifier', () => {
    expect(highJumpDistanceFt(3, true)).toBe(6);
  });
  it('standing (no running start): half of (3 + STR modifier), rounded down', () => {
    expect(highJumpDistanceFt(3, false)).toBe(3);
  });
  it('never goes negative for a very low STR modifier', () => {
    expect(highJumpDistanceFt(-5, true)).toBe(0);
    expect(highJumpDistanceFt(-5, false)).toBe(0);
  });
});

describe('standUpCostFt', () => {
  it('half of speed, rounded down', () => {
    expect(standUpCostFt(30)).toBe(15);
    expect(standUpCostFt(25)).toBe(12);
  });
});

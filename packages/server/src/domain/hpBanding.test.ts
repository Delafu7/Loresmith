import { describe, expect, it } from 'vitest';
import { bandHp } from './hpBanding.js';

describe('bandHp', () => {
  it('bands strictly above 75% as healthy', () => {
    expect(bandHp(100, 100)).toBe('healthy');
    expect(bandHp(76, 100)).toBe('healthy');
  });

  it('bands 50-75% inclusive-of-75 as injured', () => {
    expect(bandHp(75, 100)).toBe('injured');
    expect(bandHp(51, 100)).toBe('injured');
  });

  it('bands 25-50% inclusive-of-50 as bloodied', () => {
    expect(bandHp(50, 100)).toBe('bloodied');
    expect(bandHp(26, 100)).toBe('bloodied');
  });

  it('bands 1-25% inclusive-of-25 as critical', () => {
    expect(bandHp(25, 100)).toBe('critical');
    expect(bandHp(1, 100)).toBe('critical');
  });

  it('bands 0 hp as down regardless of max', () => {
    expect(bandHp(0, 100)).toBe('down');
    expect(bandHp(0, 1)).toBe('down');
  });

  it('never divides by zero for a malformed hpMax', () => {
    expect(bandHp(5, 0)).toBe('critical');
    expect(bandHp(0, 0)).toBe('down');
  });
});

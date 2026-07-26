import { describe, expect, it } from 'vitest';
import { buildHpVariants, computeHpBand, redactHpFields } from './hpVisibility.js';

describe('computeHpBand', () => {
  it('is Healthy above 75%', () => {
    expect(computeHpBand(76, 100)).toBe('Healthy');
    expect(computeHpBand(100, 100)).toBe('Healthy');
  });

  it('is Injured between 50% and 75% inclusive of the lower bound', () => {
    expect(computeHpBand(75, 100)).toBe('Injured');
    expect(computeHpBand(51, 100)).toBe('Injured');
  });

  it('is Bloodied between 25% and 50% inclusive of the lower bound', () => {
    expect(computeHpBand(50, 100)).toBe('Bloodied');
    expect(computeHpBand(26, 100)).toBe('Bloodied');
  });

  it('is Critical between 1 and 25% inclusive of the upper bound', () => {
    expect(computeHpBand(25, 100)).toBe('Critical');
    expect(computeHpBand(1, 100)).toBe('Critical');
  });

  it('is Down at exactly 0 HP or below', () => {
    expect(computeHpBand(0, 100)).toBe('Down');
    expect(computeHpBand(-5, 100)).toBe('Down');
  });

  it('treats a 0 hp_max as Down rather than dividing by zero', () => {
    expect(computeHpBand(0, 0)).toBe('Down');
  });
});

describe('buildHpVariants', () => {
  it('exact visibility sends the true numbers to both DM and player', () => {
    const { dmPayload, playerPayload } = buildHpVariants('exact', 12, 20, 3);
    expect(dmPayload).toEqual({ hpCurrent: 12, hpMax: 20, hpTemp: 3 });
    expect(playerPayload).toEqual({ hpCurrent: 12, hpMax: 20, hpTemp: 3 });
  });

  it('banded visibility sends the true numbers to the DM but only a band to the player', () => {
    const { dmPayload, playerPayload } = buildHpVariants('banded', 12, 20, 0);
    expect(dmPayload).toEqual({ hpCurrent: 12, hpMax: 20, hpTemp: 0 });
    expect(playerPayload).toEqual({ band: 'Injured' });
  });

  it('hidden visibility sends the true numbers to the DM and null to the player — never an empty/placeholder hp field', () => {
    const { dmPayload, playerPayload } = buildHpVariants('hidden', 12, 20, 0);
    expect(dmPayload).toEqual({ hpCurrent: 12, hpMax: 20, hpTemp: 0 });
    expect(playerPayload).toBeNull();
  });
});

describe('redactHpFields', () => {
  const row = { id: 1, hp_current: 8, hp_max: 20, hp_temp: 0 };

  it('exact visibility leaves the row untouched aside from a null hp_band', () => {
    expect(redactHpFields(row, 'exact')).toEqual({ ...row, hp_band: null });
  });

  it('banded visibility strips the numbers and adds hp_band', () => {
    expect(redactHpFields(row, 'banded')).toEqual({
      id: 1,
      hp_current: null,
      hp_max: null,
      hp_temp: null,
      hp_band: 'Bloodied',
    });
  });

  it('hidden visibility strips the numbers and leaves hp_band null too', () => {
    expect(redactHpFields(row, 'hidden')).toEqual({
      id: 1,
      hp_current: null,
      hp_max: null,
      hp_temp: null,
      hp_band: null,
    });
  });
});

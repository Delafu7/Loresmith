import { describe, expect, it } from 'vitest';
import { validateIdentity, validateAbilityScores, validateDerivedStats } from './validation';
import { emptyWizardDraft } from './types';

function draft(overrides: Partial<ReturnType<typeof emptyWizardDraft>> = {}) {
  return { ...emptyWizardDraft({ isPc: true, ownerUserId: '' }), ...overrides };
}

describe('validateIdentity', () => {
  it('requires a non-empty name', () => {
    expect(validateIdentity(draft({ name: '' })).valid).toBe(false);
    expect(validateIdentity(draft({ name: '  ' })).valid).toBe(false);
    expect(validateIdentity(draft({ name: 'Kaelen', raceId: 'r1', backgroundId: 'b1', classId: 'c1' })).valid).toBe(true);
  });

  it('a full (non-quick-create) build requires race, background, and class', () => {
    const withNameOnly = draft({ name: 'Kaelen', quickCreate: false });
    const v = validateIdentity(withNameOnly);
    expect(v.valid).toBe(false);
    expect(v.errors.raceId).toBe('required');
    expect(v.errors.backgroundId).toBe('required');
    expect(v.errors.classId).toBe('required');
  });

  it('quick-create (NPC-lite) only requires a name', () => {
    const v = validateIdentity(draft({ name: 'Goblin #3', quickCreate: true }));
    expect(v.valid).toBe(true);
  });
});

describe('validateAbilityScores', () => {
  it('accepts every score within [1,30]', () => {
    const v = validateAbilityScores(draft({ scores: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 } }));
    expect(v.valid).toBe(true);
  });

  it('rejects a score outside [1,30]', () => {
    const v = validateAbilityScores(draft({ scores: { str: 31, dex: 14, con: 13, int: 12, wis: 10, cha: 0 } }));
    expect(v.valid).toBe(false);
    expect(v.errors.str).toBe('outOfRange');
    expect(v.errors.cha).toBe('outOfRange');
    expect(v.errors.dex).toBeUndefined();
  });
});

describe('validateDerivedStats', () => {
  it('requires a non-negative integer AC and a positive integer HP max', () => {
    expect(validateDerivedStats(draft({ armorClass: 10, hpMax: 8 })).valid).toBe(true);
    expect(validateDerivedStats(draft({ armorClass: -1, hpMax: 8 })).valid).toBe(false);
    expect(validateDerivedStats(draft({ armorClass: 10, hpMax: 0 })).valid).toBe(false);
  });
});

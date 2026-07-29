// Unit tests for the Phase 2 selector work: `reference`/`reference-array`
// field types render as a <select>/checklist (CatalogEntryForm.tsx) instead
// of a raw-uuid text input, but they still round-trip through the same
// string-keyed DraftValues as every other field type — a single id as a
// plain string (same shape 'text' always used), an array of ids as a JSON
// string (same shape 'json' always used). These two pure functions carry
// that logic; no React Query/DOM harness needed to catch a regression here.

import { describe, expect, it } from 'vitest';
import { draftFromEntry, buildPayload } from './CatalogEntryForm';
import type { CatalogField } from './catalogEntities';
import { REFERENCE_CATALOGS } from './catalogEntities';

const singleRefField: CatalogField = {
  key: 'schoolId',
  label: 'School',
  type: 'reference',
  required: true,
  reference: REFERENCE_CATALOGS.magicSchools,
};

const arrayRefField: CatalogField = {
  key: 'savingThrowProficiencyIds',
  label: 'Saving throw proficiencies',
  type: 'reference-array',
  reference: REFERENCE_CATALOGS.abilityScores,
};

describe('draftFromEntry — reference field types', () => {
  it('hydrates a reference field as the plain id string', () => {
    const draft = draftFromEntry([singleRefField], { school_id: 'abc-123' });
    expect(draft.schoolId).toBe('abc-123');
  });

  it('hydrates a null reference field as empty string', () => {
    const draft = draftFromEntry([singleRefField], { school_id: null });
    expect(draft.schoolId).toBe('');
  });

  it('hydrates a reference-array field as a JSON string of the array', () => {
    const draft = draftFromEntry([arrayRefField], { saving_throw_proficiency_ids: ['a', 'b'] });
    expect(JSON.parse(draft.savingThrowProficiencyIds!)).toEqual(['a', 'b']);
  });

  it('defaults both reference types to empty string for a new entry', () => {
    const draft = draftFromEntry([singleRefField, arrayRefField], null);
    expect(draft.schoolId).toBe('');
    expect(draft.savingThrowProficiencyIds).toBe('');
  });
});

describe('buildPayload — reference field types', () => {
  it('passes a selected reference id through as a plain string', () => {
    const payload = buildPayload([singleRefField], { schoolId: 'abc-123' });
    expect(payload.schoolId).toBe('abc-123');
  });

  it('sends null for an untouched optional reference-array field', () => {
    const payload = buildPayload([arrayRefField], { savingThrowProficiencyIds: '' });
    expect(payload.savingThrowProficiencyIds).toBeNull();
  });

  it('parses a reference-array field back into a real array', () => {
    const payload = buildPayload([arrayRefField], { savingThrowProficiencyIds: '["a","b"]' });
    expect(payload.savingThrowProficiencyIds).toEqual(['a', 'b']);
  });

  it('throws a field-identifying error on corrupt reference-array JSON', () => {
    expect(() => buildPayload([arrayRefField], { savingThrowProficiencyIds: 'not json' })).toThrow(
      /Saving throw proficiencies/,
    );
  });
});

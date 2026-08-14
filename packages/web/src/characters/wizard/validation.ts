// Per-step pure validation — this app's existing ad-hoc `validate(state)`
// convention (no new client-side validation library). Each function returns
// every error keyed by field so a step component can show them inline, plus
// `valid` for the "Next" button's disabled state. Point-buy over-budget
// rejection and standard-array reset are already enforced inside
// AbilityScoreGenerator itself (its own Apply button disables on overspend)
// — this file doesn't re-validate that, only the raw [1,30] schema bound
// every score must satisfy regardless of which mode produced it.
import type { WizardDraft } from './types';

export interface StepValidation {
  errors: Partial<Record<string, string>>;
  valid: boolean;
}

function result(errors: Partial<Record<string, string>>): StepValidation {
  return { errors, valid: Object.keys(errors).length === 0 };
}

export function validateIdentity(draft: WizardDraft): StepValidation {
  const errors: Partial<Record<string, string>> = {};
  if (!draft.name.trim()) errors.name = 'required';
  // Quick-create (NPC-lite) skips the "build toward a complete character"
  // push — a full-wizard character is expected to at least have picked a
  // race/background/class before moving on, an NPC-lite one isn't.
  if (!draft.quickCreate) {
    if (!draft.raceId) errors.raceId = 'required';
    if (!draft.backgroundId) errors.backgroundId = 'required';
    if (!draft.classId) errors.classId = 'required';
  }
  return result(errors);
}

export function validateAbilityScores(draft: WizardDraft): StepValidation {
  const errors: Partial<Record<string, string>> = {};
  for (const [key, score] of Object.entries(draft.scores)) {
    if (!Number.isInteger(score) || score < 1 || score > 30) errors[key] = 'outOfRange';
  }
  return result(errors);
}

export function validateDerivedStats(draft: WizardDraft): StepValidation {
  const errors: Partial<Record<string, string>> = {};
  if (!Number.isInteger(draft.armorClass) || draft.armorClass < 0) errors.armorClass = 'invalid';
  if (!Number.isInteger(draft.hpMax) || draft.hpMax < 1) errors.hpMax = 'invalid';
  return result(errors);
}

// Skills, equipment, and portrait are all optional/never block advancement —
// nothing in the SRD requires a fully-built character before it can exist
// as a row, and the app's own existing quick-create form creates characters
// with none of this at all today.
export function validateSkills(_draft: WizardDraft): StepValidation {
  return result({});
}
export function validateFeats(_draft: WizardDraft): StepValidation {
  return result({});
}
export function validateEquipment(_draft: WizardDraft): StepValidation {
  return result({});
}
export function validatePortrait(_draft: WizardDraft): StepValidation {
  return result({});
}

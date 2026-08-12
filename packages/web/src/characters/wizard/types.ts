// Shared draft shape for the character creation wizard. Purely local state
// until the Equipment->Portrait transition, which is when the real
// POST /campaigns/:id/characters (+ classes/proficiencies/items) actually
// fires — see CharacterCreationWizard.tsx's submitCharacter for why the
// wizard doesn't just POST once at the very last step (the portrait step
// needs a real characterId to attach an upload to; see ImageUploadField's
// characterId prop / services/assets.ts's auto-link-on-upload behavior).
import type { AbilityKey } from '../abilityScoreGeneration';

export type SkillProficiencyLevel = 'proficient' | 'expertise';

export interface WizardEquipmentPick {
  itemId: string;
  name: string;
  quantity: number;
}

export interface WizardDraft {
  // Identity
  name: string;
  isPc: boolean;
  ownerUserId: string; // '' = unassigned (DM) / forced to the player's own id elsewhere
  raceId: string; // '' = none picked
  subraceId: string;
  backgroundId: string;
  classId: string; // '' = none picked
  subclassId: string;
  level: number;
  alignment: string;
  /** NPC-lite mode — skips race/background/class requirements in IdentityStep's validation and can skip straight to Equipment/Portrait. */
  quickCreate: boolean;

  // Ability scores — same Record<AbilityKey, number> shape AbilityScoreGenerator.onApply hands back.
  scores: Record<AbilityKey, number>;

  // Derived (the two fields createCharacterSchema actually requires that
  // nothing else in the wizard produces automatically)
  armorClass: number;
  hpMax: number;

  // Skills / saves — keyed by catalog id; a skill absent from skillLevels is 'none'.
  skillLevels: Record<string, SkillProficiencyLevel>;
  savingThrowAbilityScoreIds: string[];

  // Equipment — resolved against the item catalog in EquipmentStep.
  equipment: WizardEquipmentPick[];
  notes: string;

  // Portrait — only settable once createdCharacterId exists.
  portraitAssetId: string | null;

  // Set once the real character row exists (Equipment->Portrait transition).
  // Every earlier step becomes read-only once this is non-null — further
  // edits belong on the normal CharacterSheetPage, not this wizard (see
  // CharacterCreationWizard.tsx's header comment).
  createdCharacterId: string | null;
}

export const WIZARD_STEP_IDS = ['identity', 'abilityScores', 'derivedStats', 'skills', 'equipment', 'portrait'] as const;
export type WizardStepId = (typeof WIZARD_STEP_IDS)[number];

export function emptyWizardDraft(defaults: { isPc: boolean; ownerUserId: string }): WizardDraft {
  return {
    name: '',
    isPc: defaults.isPc,
    ownerUserId: defaults.ownerUserId,
    raceId: '',
    subraceId: '',
    backgroundId: '',
    classId: '',
    subclassId: '',
    level: 1,
    alignment: '',
    quickCreate: false,
    scores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    armorClass: 10,
    hpMax: 10,
    skillLevels: {},
    savingThrowAbilityScoreIds: [],
    equipment: [],
    notes: '',
    portraitAssetId: null,
    createdCharacterId: null,
  };
}

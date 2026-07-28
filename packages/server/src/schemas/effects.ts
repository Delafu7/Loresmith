import { z } from 'zod';

const durationTypeEnum = z.enum(['rounds', 'minutes', 'hours', 'until_save', 'until_removed', 'permanent', 'special']);
const sourceTypeEnum = z.enum(['spell', 'class_feature', 'monster_ability', 'item', 'manual']);

// Fields shared by every "apply an effect" endpoint. durationType/
// durationValue/concentration are all optional here — when omitted, the
// service falls back to the effect_definitions row's own
// default_duration_type/default_duration_value/concentration, so applying a
// stock condition (e.g. Poisoned) doesn't require repeating its template
// defaults on every call; a caller can still override for a homebrew/one-off
// duration (e.g. "poisoned for exactly 3 rounds by this specific trap").
const baseApplyEffectShape = {
  effectDefinitionId: z.number().int().positive(),
  sourceCharacterId: z.number().int().positive().optional().nullable(),
  sourceSpellId: z.number().int().positive().optional().nullable(),
  sourceType: sourceTypeEnum.default('manual'),
  durationType: durationTypeEnum.optional(),
  durationValue: z.number().int().optional().nullable(),
  stackCount: z.number().int().optional().nullable(),
  appliedAtRound: z.number().int().optional().nullable(),
  saveDc: z.number().int().optional().nullable(),
  saveAbilityId: z.number().int().positive().optional().nullable(),
  concentration: z.boolean().optional(),
  notes: z.string().max(5000).optional().nullable(),
};

// Used by POST /characters/:id/effects and POST /monster-instances/:id/effects
// — the target is the URL's :id, so the body carries no characterId/
// monsterInstanceId of its own.
export const applyTargetEffectSchema = z.object(baseApplyEffectShape);
export type ApplyTargetEffectInput = z.infer<typeof applyTargetEffectSchema>;

// Used by POST /encounters/:id/effects — the encounter is the URL's :id, but
// the target within it (a character OR a monster instance participant) must
// still be named in the body.
export const applyEncounterEffectSchema = z
  .object({
    ...baseApplyEffectShape,
    characterId: z.number().int().positive().optional(),
    monsterInstanceId: z.number().int().positive().optional(),
  })
  .refine((v) => (v.characterId != null) !== (v.monsterInstanceId != null), {
    message: 'Exactly one of characterId or monsterInstanceId must be provided',
  });
export type ApplyEncounterEffectInput = z.infer<typeof applyEncounterEffectSchema>;

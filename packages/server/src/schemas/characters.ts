import { z } from 'zod';

const abilityScore = z.number().int().min(1).max(30);

// NOTE: zod's `.partial()` does NOT strip `.default()` off a field — a field
// declared `z.boolean().default(true)` still gets coerced to `true` by
// `.partial().parse({})` even though the key was never sent, because the
// default fires before the optional-wrapping is considered. Building
// createCharacterSchema as `sharedShape.extend({ ...defaulted fields })`
// keeps those defaults for CREATE while updateCharacterSchema is built from
// the default-free `sharedShape`, so an omitted field on PATCH stays
// genuinely absent instead of silently overwriting the existing DB value.
const sharedCharacterShape = {
  name: z.string().min(1).max(200),
  isPc: z.boolean(),
  ownerUserId: z.number().int().positive().optional().nullable(),
  raceId: z.number().int().positive().optional().nullable(),
  subraceId: z.number().int().positive().optional().nullable(),
  backgroundId: z.number().int().positive().optional().nullable(),
  alignment: z.string().max(50).optional().nullable(),
  str: abilityScore,
  dex: abilityScore,
  con: abilityScore,
  int: abilityScore,
  wis: abilityScore,
  cha: abilityScore,
  armorClass: z.number().int().min(0),
  speed: z.number().int().min(0),
  hpMax: z.number().int().min(1),
  hpCurrent: z.number().int().min(0).optional(), // create: defaults to hpMax (service-level, not schema-level)
  hpTemp: z.number().int().min(0),
  hitDiceRemaining: z.record(z.string(), z.number().int()).optional().nullable(),
  exhaustionLevel: z.number().int().min(0).max(6),
  senses: z.string().max(500).optional().nullable(),
  languages: z.array(z.number().int().positive()).optional().nullable(),
  notes: z.string().max(20000).optional().nullable(),
};

export const createCharacterSchema = z.object(sharedCharacterShape).extend({
  isPc: z.boolean().default(true),
  speed: z.number().int().min(0).default(30),
  hpTemp: z.number().int().min(0).default(0),
  exhaustionLevel: z.number().int().min(0).max(6).default(0),
});
export type CreateCharacterInput = z.infer<typeof createCharacterSchema>;

export const updateCharacterSchema = z.object(sharedCharacterShape).partial();
export type UpdateCharacterInput = z.infer<typeof updateCharacterSchema>;

export const hpDeltaSchema = z.object({
  delta: z.number().int().default(0),
  tempDelta: z.number().int().default(0),
});
export type HpDeltaInput = z.infer<typeof hpDeltaSchema>;

export const replaceClassesSchema = z.array(
  z.object({
    classId: z.number().int().positive(),
    subclassId: z.number().int().positive().optional().nullable(),
    level: z.number().int().min(1).max(20),
  }),
);
export type ReplaceClassesInput = z.infer<typeof replaceClassesSchema>;

export const replaceSkillProficienciesSchema = z.array(
  z.object({
    skillId: z.number().int().positive(),
    level: z.enum(['proficient', 'expertise']),
  }),
);
export type ReplaceSkillProficienciesInput = z.infer<typeof replaceSkillProficienciesSchema>;

export const replaceSavingThrowProficienciesSchema = z.array(
  z.object({
    abilityScoreId: z.number().int().positive(),
  }),
);
export type ReplaceSavingThrowProficienciesInput = z.infer<typeof replaceSavingThrowProficienciesSchema>;

// Exhaustion is its own explicit, DM-only endpoint (not folded into the
// general character PATCH) — see services/characters.ts's updateExhaustion.
export const exhaustionSchema = z.object({
  level: z.number().int().min(0).max(6),
});
export type ExhaustionInput = z.infer<typeof exhaustionSchema>;

// Armor class mode toggle is its own explicit endpoint too (Phase 3.5), same
// reasoning as exhaustion above — see services/characters.ts's
// updateArmorClassMode. No changes needed to updateCharacterSchema itself:
// it already has armorClass as an updatable field from before this phase,
// and the "ignore a client-supplied armorClass while in auto mode" behavior
// lives in the service layer, not the schema.
export const updateArmorClassModeSchema = z.object({
  mode: z.enum(['auto', 'manual']),
});
export type UpdateArmorClassModeInput = z.infer<typeof updateArmorClassModeSchema>;

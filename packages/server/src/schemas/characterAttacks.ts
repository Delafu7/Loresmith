import { z } from 'zod';

// REFACTOR-PLAN.md §6 / docs/rules/attacks-and-damage.md §2.1 — deliberately
// close to monsters' existing statBlockEntrySchema field names
// (attackBonus/damageDice/damageType/saveDc/saveAbilityIndex) so the web
// layer's rendering logic generalizes across both. Exactly one of
// attackBonus/saveDc may be set (or neither, for a pure-flavor entry — same
// permissive shape monsters' actions already allow), matching the DB CHECK
// constraint added in this migration.
const sharedCharacterAttackShape = {
  name: z.string().min(1).max(200),
  attackBonus: z.number().int().optional().nullable(),
  damageDice: z.string().max(50).optional().nullable(),
  damageType: z.string().max(50).optional().nullable(),
  saveDc: z.number().int().positive().optional().nullable(),
  saveAbilityIndex: z.string().max(10).optional().nullable(),
  halfOnSave: z.boolean().optional(),
  notes: z.string().max(2000).optional().nullable(),
  sortOrder: z.number().int().optional(),
};

export const createCharacterAttackSchema = z
  .object(sharedCharacterAttackShape)
  .extend({ halfOnSave: z.boolean().default(true), sortOrder: z.number().int().default(0) })
  .refine((v) => !(v.attackBonus != null && v.saveDc != null), {
    message: 'attackBonus and saveDc are mutually exclusive',
  });
export type CreateCharacterAttackInput = z.infer<typeof createCharacterAttackSchema>;

export const updateCharacterAttackSchema = z.object(sharedCharacterAttackShape).partial();
export type UpdateCharacterAttackInput = z.infer<typeof updateCharacterAttackSchema>;

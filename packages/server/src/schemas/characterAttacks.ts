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
  // docs/roadmap/dnd-2024-gap-analysis.md P1-6 — link to the catalog weapon
  // this attack represents, so its Weapon Mastery property (items.properties
  // .mastery) can be resolved server-side. Optional/nullable: spell attacks,
  // monster-flavor entries, and homebrew rows with no catalog weapon behind
  // them keep this null, same as every other optional field here.
  itemId: z.string().uuid().optional().nullable(),
};

export const createCharacterAttackSchema = z
  .object(sharedCharacterAttackShape)
  .extend({ halfOnSave: z.boolean().default(true), sortOrder: z.number().int().default(0) })
  .refine((v) => !(v.attackBonus != null && v.saveDc != null), {
    message: 'attackBonus and saveDc are mutually exclusive',
  });
export type CreateCharacterAttackInput = z.infer<typeof createCharacterAttackSchema>;

// Iteration 3 minor sweep — this used to be a bare .partial() with none of
// createCharacterAttackSchema's .refine() guard, even though the same DB
// CHECK constraint applies to every row regardless of which endpoint wrote
// it. This catches the common/direct case (a client sets both fields in
// ONE PATCH payload) at the validation layer with a clean 400; it can't
// catch "the row already has attackBonus set, this PATCH only sets saveDc"
// (the payload alone doesn't reveal that conflict) — services/
// characterAttacks.ts's updateCharacterAttack additionally catches the raw
// DB check-violation for that case, same isCheckViolation pattern
// services/characters.ts's insertCharacterRow already uses.
export const updateCharacterAttackSchema = z
  .object(sharedCharacterAttackShape)
  .partial()
  .refine((v) => !(v.attackBonus != null && v.saveDc != null), {
    message: 'attackBonus and saveDc are mutually exclusive',
  });
export type UpdateCharacterAttackInput = z.infer<typeof updateCharacterAttackSchema>;

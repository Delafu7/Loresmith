import { z } from 'zod';
import { updateHomebrewMonsterSchema } from './monsterCatalog.js';

// Campaign bestiary curation (Task 1) — add/edit/remove a reference to a
// catalog monster within one campaign, distinct from both the catalog write
// path (monsterCatalog.ts) and the combat-instance path (monsters.ts).

export const addToBestiarySchema = z.object({
  monsterIds: z.array(z.string().uuid()).min(1).max(200),
});
export type AddToBestiaryInput = z.infer<typeof addToBestiarySchema>;

// Iteration 2 "Shared bestiary" — bulk sibling of the single-entry DELETE
// /:entryId route, mirroring the bulk-add shape above.
export const removeFromBestiarySchema = z.object({
  entryIds: z.array(z.string().uuid()).min(1).max(200),
});
export type RemoveFromBestiaryInput = z.infer<typeof removeFromBestiarySchema>;

// statOverrides reuses updateHomebrewMonsterSchema wholesale (already a
// no-`.default()` .partial() of every monsters column) rather than
// duplicating a second copy of the same ~30-field shape — it stays in sync
// automatically as the monster schema evolves. No `.default()` here either,
// for the same "PATCH omission must not reintroduce a value" reason as
// updateHomebrewMonsterSchema's own header comment.
// clearOverrides: Iteration 3 minor sweep — statOverrides' fields (armorClass,
// hitPointAverage, ...) are non-nullable on updateHomebrewMonsterSchema
// (deliberately — a homebrew monster's OWN row must always have a real AC/
// HP, so loosening that shared schema to accept null would let a client
// clear the catalog row's actual stat, not just an override). A campaign
// bestiary override is sparse by design, though, and needed a way to remove
// one that was never expressible: this lists override KEYS to delete from
// the stored JSONB blob, applied after statOverrides' own shallow-merge —
// a separate mechanism rather than loosening the shared schema's own
// nullability.
export const updateBestiaryEntrySchema = z.object({
  customName: z.string().max(200).optional().nullable(),
  statOverrides: updateHomebrewMonsterSchema.optional(),
  clearOverrides: z.array(z.string().max(100)).max(30).optional(),
  notes: z.string().max(20000).optional().nullable(),
  discovered: z.boolean().optional(),
});
export type UpdateBestiaryEntryInput = z.infer<typeof updateBestiaryEntrySchema>;

// Attach an existing category by id, or create-or-find one by name (case
// sensitive match against campaign_categories' own UNIQUE(campaign_id,
// entity_type, name)) and attach that — exactly one of the two shapes,
// never both.
export const attachCategorySchema = z
  .object({
    categoryId: z.string().uuid().optional(),
    name: z.string().min(1).max(100).optional(),
    color: z.string().max(50).optional().nullable(),
    icon: z.string().max(50).optional().nullable(),
  })
  .refine((v) => (v.categoryId !== undefined) !== (v.name !== undefined), {
    message: 'Provide exactly one of categoryId or name',
  });
export type AttachCategoryInput = z.infer<typeof attachCategorySchema>;

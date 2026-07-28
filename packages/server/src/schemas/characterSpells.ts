import { z } from 'zod';

export const createCharacterSpellSchema = z.object({
  spellId: z.string().uuid(),
  classId: z.string().uuid().optional().nullable(),
  isPrepared: z.boolean().default(false),
  alwaysPrepared: z.boolean().default(false),
  source: z.enum(['class', 'race', 'feat', 'item']).default('class'),
});
export type CreateCharacterSpellInput = z.infer<typeof createCharacterSpellSchema>;

// PATCH .../spells/:spellId only ever toggles is_prepared (task brief) —
// re-learning a different class/source is a delete + re-create, not a PATCH.
export const updateCharacterSpellSchema = z.object({
  isPrepared: z.boolean(),
});
export type UpdateCharacterSpellInput = z.infer<typeof updateCharacterSpellSchema>;

// character_spells is unique on (character_id, spell_id, class_id), so a
// multiclass caster who has the SAME spell available via two different
// granting classes has two rows for one spellId — :spellId alone is
// ambiguous in that (rare) case. ?classId= disambiguates; PATCH/DELETE
// return a clear VALIDATION_ERROR listing the candidates rather than
// guessing or silently acting on the first match.
export const spellRowQuerySchema = z.object({
  classId: z.string().uuid().optional(),
});
export type SpellRowQuery = z.infer<typeof spellRowQuerySchema>;

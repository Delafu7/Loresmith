import { z } from 'zod';

// docs/roadmap/dnd-2024-gap-analysis.md P1-6 — PUT /characters/:id/weapon-masteries
// replaces the character's full "known masteries" choice set in one call
// (same "replace, don't diff" shape as replaceClassesSchema/
// replaceSkillProficienciesSchema in schemas/characters.ts), matching the
// PHB's own framing ("change one of those weapon choices" on a Long Rest —
// a fresh choice, not an incremental add).
export const setCharacterWeaponMasteriesSchema = z.object({
  itemIds: z.array(z.string().uuid()).max(20),
});
export type SetCharacterWeaponMasteriesInput = z.infer<typeof setCharacterWeaponMasteriesSchema>;

// docs/roadmap/dnd-2024-gap-analysis.md P1-6 — POST /characters/:id/weapon-mastery-trigger
// (:id = the ATTACKING character). "Track state, don't auto-consult it" per
// this project's own established philosophy (see the SPELL_EFFECT_DEFINITIONS
// comment in db/seeds/catalog.ts): this resolves which mastery property a
// weapon carries, checks whether the attacker actually knows it, and either
// writes a real active_effects row (Sap/Vex/Slow) or returns a descriptive
// payload for a property that resolves through an existing endpoint instead
// (Cleave/Graze/Nick/Push/Topple) — it never itself rolls dice, moves a
// token, or auto-derives advantage for a future roll.
export const weaponMasteryTriggerSchema = z
  .object({
    weaponItemId: z.string().uuid().optional(),
    characterAttackId: z.string().uuid().optional(),
    outcome: z.enum(['hit', 'miss']),
    targetCharacterId: z.string().uuid().optional(),
    targetMonsterInstanceId: z.string().uuid().optional(),
    // Whether damage actually reached the target this hit — Vex/Slow both
    // require "and deal damage to it", not just "hit" (a hit fully absorbed
    // by resistance/immunity down to 0 applied damage doesn't trigger them).
    damageDealt: z.number().int().min(0).optional(),
    encounterId: z.string().uuid().optional(),
  })
  .refine((v) => (v.weaponItemId != null) !== (v.characterAttackId != null), {
    message: 'Exactly one of weaponItemId or characterAttackId must be provided',
  })
  .refine((v) => (v.targetCharacterId != null) !== (v.targetMonsterInstanceId != null), {
    message: 'Exactly one of targetCharacterId or targetMonsterInstanceId must be provided',
  });
export type WeaponMasteryTriggerInput = z.infer<typeof weaponMasteryTriggerSchema>;

import { z } from 'zod';

// Casting from the encounter runner (brief: "spend the slot, apply the
// effect/condition to targets"). Bundles two already-correct primitives —
// resourcePools.ts's spendResource and effects.ts's applyEncounterEffect —
// into one action; see services/casting.ts's header comment for why full
// cross-call transactional atomicity is deliberately out of scope.
export const castFromEncounterSchema = z
  .object({
    characterId: z.string().uuid(),
    // e.g. 'spell_slot_2', 'warlock_pact_slot_1' — matches
    // character_resource_pools.resource_key exactly, same string the
    // character sheet's SpellcastingPanel already spends against.
    resourceKey: z.string().min(1),
    spellId: z.string().uuid().optional().nullable(),
    // Omit to just spend the slot with no mechanical condition to track
    // (e.g. a pure-damage spell with nothing for active_effects to model).
    effectDefinitionId: z.string().uuid().optional(),
    targetParticipantIds: z.array(z.string().uuid()).default([]),
    durationValue: z.number().int().optional().nullable(),
    saveDc: z.number().int().optional().nullable(),
    saveAbilityId: z.string().uuid().optional().nullable(),
    concentration: z.boolean().optional(),
    notes: z.string().max(5000).optional().nullable(),
  })
  .refine((v) => v.effectDefinitionId == null || v.targetParticipantIds.length > 0, {
    message: 'targetParticipantIds is required when effectDefinitionId is provided',
  });
export type CastFromEncounterInput = z.infer<typeof castFromEncounterSchema>;

import { z } from 'zod';

// Action recording (nav point 2). actorParticipantId (not a raw character/
// monster-instance id) so authorization can reuse encounters.ts's existing
// authorizeParticipantAction — the actor must be a live participant in THIS
// encounter, and the caller must be the DM or that participant's owner.
// Targets are participant ids too, for the same "must be seated in this
// encounter" reasoning; the service resolves both down to the
// character_id/monster_instance_id the combat_actions/combat_action_targets
// rows actually store, so the log survives a participant later being removed.
export const actionTypeEnum = z.enum([
  'melee_attack',
  'ranged_attack',
  'spell',
  'ability',
  'item',
  'healing',
  'movement',
  'other',
]);

export const resultKindEnum = z.enum(['hit', 'miss', 'save_success', 'save_fail', 'effect', 'n/a']);

export const recordActionSchema = z.object({
  actorParticipantId: z.string().uuid(),
  targetParticipantIds: z.array(z.string().uuid()).max(20).default([]),
  actionType: actionTypeEnum,
  meansItemId: z.string().uuid().optional(),
  meansSpellId: z.string().uuid().optional(),
  meansCharacterAttackId: z.string().uuid().optional(),
  meansLabel: z.string().max(200).optional(),
  diceRollId: z.string().uuid().optional(),
  resultKind: resultKindEnum.optional(),
  damageAmount: z.number().int().nonnegative().optional(),
  damageTypeId: z.string().uuid().optional(),
  effectDescription: z.string().max(500).optional(),
});
export type RecordActionInput = z.infer<typeof recordActionSchema>;

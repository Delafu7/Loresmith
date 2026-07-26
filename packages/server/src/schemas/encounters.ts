import { z } from 'zod';

export const createEncounterSchema = z.object({
  name: z.string().min(1).max(200),
});
export type CreateEncounterInput = z.infer<typeof createEncounterSchema>;

// Status transitions go through dedicated /start and /end actions rather
// than a free-form PATCH — PATCH only touches the encounter's display name.
export const updateEncounterSchema = z.object({
  name: z.string().min(1).max(200).optional(),
});
export type UpdateEncounterInput = z.infer<typeof updateEncounterSchema>;

export const hpVisibilityEnum = z.enum(['exact', 'banded', 'hidden']);

// REFACTOR-PLAN.md §3: board-readability faction, distinct from hpVisibility.
export const participantFactionEnum = z.enum(['player', 'ally', 'enemy', 'neutral']);

export const addParticipantSchema = z
  .object({
    characterId: z.number().int().positive().optional(),
    monsterInstanceId: z.number().int().positive().optional(),
    initiativeRoll: z.number().int().optional(), // omit to roll later via /roll-initiative
    hpVisibility: hpVisibilityEnum.optional(),
    // Omit to default player/enemy by character-vs-monster-instance, same as
    // hpVisibility's own default derivation just above.
    faction: participantFactionEnum.optional(),
  })
  .refine((v) => (v.characterId != null) !== (v.monsterInstanceId != null), {
    message: 'Exactly one of characterId or monsterInstanceId must be provided',
  });
export type AddParticipantInput = z.infer<typeof addParticipantSchema>;

export const rollInitiativeSchema = z.object({
  force: z.boolean().default(false),
});
export type RollInitiativeInput = z.infer<typeof rollInitiativeSchema>;

export const setInitiativeSchema = z.object({
  initiativeRoll: z.number().int(),
  initiativeTiebreak: z.number().int().optional().nullable(),
});
export type SetInitiativeInput = z.infer<typeof setInitiativeSchema>;

export const setParticipantFactionSchema = z.object({
  faction: participantFactionEnum,
});
export type SetParticipantFactionInput = z.infer<typeof setParticipantFactionSchema>;

// All fields optional — a DM might just want to change grid size without
// touching the background, or vice versa. Upsert only overwrites fields that
// were actually supplied (see services/encounters.ts's upsertEncounterMap).
// Bounds mirror the frontend's GRID_MIN/GRID_MAX clamp (BattleMap.tsx) — the
// UI clamp is a UX nicety, not the trust boundary, since this endpoint is
// reachable directly (curl, a modified client) by any DM. Without a server
// max, an oversized grid would broadcast room-wide via MAP_UPDATED and hang
// every connected client's `Array.from({length: columns*rows})` render.
export const upsertEncounterMapSchema = z.object({
  backgroundAssetId: z.number().int().positive().nullable().optional(),
  gridColumns: z.number().int().min(5).max(50).optional(),
  gridRows: z.number().int().min(5).max(50).optional(),
  cellSizePx: z.number().int().min(10).max(200).optional(),
});
export type UpsertEncounterMapInput = z.infer<typeof upsertEncounterMapSchema>;

// Both x/y present together — setting a token's position or clearing it
// entirely by sending both null. Not cross-validated against the map's
// grid_columns/grid_rows bounds (permissive, "trust the DM" posture).
export const setParticipantPositionSchema = z
  .object({
    x: z.number().int().nonnegative().nullable(),
    y: z.number().int().nonnegative().nullable(),
  })
  .refine((v) => (v.x === null) === (v.y === null), {
    message: 'x and y must both be set or both be null',
  });
export type SetParticipantPositionInput = z.infer<typeof setParticipantPositionSchema>;

// Deliberately generic: the backend only knows about the four 5e economy
// *slots* (action/bonus action/reaction/movement), never named actions like
// "Dash" or "Shove" — those live purely in the frontend's action registry
// (components/actionEconomy.ts) as slot + optional roll-trigger metadata.
// Adding a new named action later (Dodge, Help, Hide, ...) is then a
// frontend-only change; this endpoint and schema never need to grow. At
// least one of `spend`/`addMovementFt` must be present.
export const applyActionEconomySchema = z
  .object({
    spend: z.enum(['action', 'bonus_action', 'reaction']).optional(),
    // Only meaningful alongside spend:'action' — Dash both consumes the
    // action slot AND doubles the movement budget, so the server needs to
    // know it was specifically Dash, not some other action.
    dash: z.boolean().optional(),
    addMovementFt: z.number().int().positive().optional(),
  })
  .refine((v) => v.spend !== undefined || v.addMovementFt !== undefined, {
    message: 'At least one of spend or addMovementFt is required',
  });
export type ApplyActionEconomyInput = z.infer<typeof applyActionEconomySchema>;

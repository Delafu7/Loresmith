import { z } from 'zod';

export const createEncounterSchema = z.object({
  name: z.string().min(1).max(200),
});
export type CreateEncounterInput = z.infer<typeof createEncounterSchema>;

// Status transitions go through dedicated /start and /end actions rather
// than a free-form PATCH — PATCH only touches display/setup metadata
// (name, and now lairActions), never status/mode/turn state.
const lairActionEntrySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(20000),
});
export const updateEncounterSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  // Phase 2 "lair actions (round-start trigger)" — a lair belongs to a
  // place/scene, not a monster type, so the DM sets this up per-encounter
  // at prep time rather than it coming from a monster's own catalog row.
  lairActions: z.array(lairActionEntrySchema).optional().nullable(),
  // Phase 3 "terrain/complications on encounters" — free text, visible to
  // every campaign member (unlike lairActions above).
  terrainNotes: z.string().max(5000).optional().nullable(),
  // Phase 3 "locations and factions".
  locationId: z.string().uuid().optional().nullable(),
});
export type UpdateEncounterInput = z.infer<typeof updateEncounterSchema>;

// REFACTOR-PLAN.md §3: board-readability faction.
export const participantFactionEnum = z.enum(['player', 'ally', 'enemy', 'neutral']);

// Exploration (free player movement, no turn/budget checks) vs. combat
// (today's strict turn-order + movement-budget enforcement) — independent of
// `status`, a separate DM toggle. See services/encounters.ts's
// computeValidatedMoveCost and 1784269777666_add-encounter-mode.ts.
export const encounterModeEnum = z.enum(['exploration', 'combat']);
export const setEncounterModeSchema = z.object({ mode: encounterModeEnum });
export type SetEncounterModeInput = z.infer<typeof setEncounterModeSchema>;

export const addParticipantSchema = z
  .object({
    characterId: z.string().uuid().optional(),
    monsterInstanceId: z.string().uuid().optional(),
    initiativeRoll: z.number().int().optional(), // omit to roll later via /roll-initiative
    // Omit to default player/enemy by character-vs-monster-instance.
    faction: participantFactionEnum.optional(),
  })
  .refine((v) => (v.characterId != null) !== (v.monsterInstanceId != null), {
    message: 'Exactly one of characterId or monsterInstanceId must be provided',
  });
export type AddParticipantInput = z.infer<typeof addParticipantSchema>;

// Iteration 2 §"Fast add/spawn UX" — batches what used to be `quantity`
// sequential POST /monster-instances + POST /participants round-trips into
// one transactional request. `hpStrategy` follows the dnd-rules-confirmed
// convention: 'average' reuses the catalog's hit_point_average for every
// instance (today's only behavior, kept as the default so existing callers
// see no change), 'rolled' rolls the monster's hit_dice independently per
// instance, 'same' rolls once and reuses that single result for the whole
// batch. `groupInitiative` defaults to true because the SRD treats a group
// of identical creatures rolling one shared initiative as core procedure in
// both editions, not an optional variant (see docs/rules/monster-spawning.md).
export const hpStrategyEnum = z.enum(['average', 'rolled', 'same']);
export const namingSchemeEnum = z.enum(['numeric', 'alpha']);
export const spawnParticipantsSchema = z.object({
  monsterId: z.string().uuid(),
  quantity: z.number().int().min(1).max(20),
  hpStrategy: hpStrategyEnum.default('average'),
  groupInitiative: z.boolean().default(true),
  customBaseName: z.string().trim().min(1).max(100).optional(),
  namingScheme: namingSchemeEnum.default('numeric'),
});
export type SpawnParticipantsInput = z.infer<typeof spawnParticipantsSchema>;

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

// Encounter visibility by state (nav point 1) — DM-only toggle for whether a
// participant row exists at all in a non-DM viewer's roster/snapshot.
export const setParticipantVisibilitySchema = z.object({
  visible: z.boolean(),
});
export type SetParticipantVisibilityInput = z.infer<typeof setParticipantVisibilitySchema>;

// Phase 2 "restore hp_visibility + banding" — DM-only toggle for how much
// of a participant's HP a non-DM viewer sees. Orthogonal to `visible`
// above: a participant can be fully visible on the roster with its HP
// banded or hidden.
export const setParticipantHpVisibilitySchema = z.object({
  hpVisibility: z.enum(['exact', 'banded', 'hidden']),
});
export type SetParticipantHpVisibilityInput = z.infer<typeof setParticipantHpVisibilitySchema>;

// DM battle-map vision feature — see 1784269817666_add-participant-vision.ts.
// Encounter-scoped (not a character/monster-instance property), DM-tunable
// per fight, mirroring setParticipantFactionSchema's "one small DM knob"
// shape. All three fields optional so the DM can patch just one at a time
// (e.g. flip visionEnabled without resending the radii).
export const setParticipantVisionSchema = z.object({
  visionEnabled: z.boolean().optional(),
  visionRadiusFt: z.number().int().min(0).max(1000).optional(),
  darkvisionRadiusFt: z.number().int().min(0).max(1000).optional(),
});
export type SetParticipantVisionInput = z.infer<typeof setParticipantVisionSchema>;

// Phase 2 "legendary actions per-round counters" — cost defaults to 1
// (the SRD default) when omitted, matching StatBlockEntry.cost's own default.
export const spendLegendaryActionSchema = z.object({
  cost: z.number().int().positive().optional(),
});
export type SpendLegendaryActionInput = z.infer<typeof spendLegendaryActionSchema>;

// Encounter-level disposition (orthogonal to combat_participants.faction —
// see 1784269787666_add-encounter-disposition.ts's header comment). Only
// `toDisposition` is caller-supplied; `fromDisposition` is read server-side
// from the current row so the logged transition can't be spoofed to not
// match what was actually true beforehand.
export const encounterDispositionEnum = z.enum(['friendly', 'neutral', 'hostile', 'unknown']);
export const transitionDispositionSchema = z.object({
  toDisposition: encounterDispositionEnum,
  note: z.string().max(500).optional(),
});
export type TransitionDispositionInput = z.infer<typeof transitionDispositionSchema>;

// REFACTOR-PLAN.md §4 / docs/rules/movement.md §2.1 — 'normal' is
// deliberately not a valid value here; a normal cell is the absence of a
// row (see map_cell_overrides' own "sparse table" comment), so removing an
// override (DELETE) is how a cell goes back to normal, not a PUT with this value.
export const upsertCellOverrideSchema = z.object({
  costType: z.enum(['difficult', 'impassable', 'special']),
  medium: z.enum(['ground', 'water', 'air', 'underground']).optional(),
  specialCostFt: z.number().int().positive().optional().nullable(),
  note: z.string().max(200).optional().nullable(),
});
export type UpsertCellOverrideInput = z.infer<typeof upsertCellOverrideSchema>;

// All fields optional — a DM might just want to change grid size without
// touching the background, or vice versa. Upsert only overwrites fields that
// were actually supplied (see services/encounters.ts's upsertEncounterMap).
// Bounds mirror the frontend's GRID_MIN/GRID_MAX clamp (BattleMap.tsx) — the
// UI clamp is a UX nicety, not the trust boundary, since this endpoint is
// reachable directly (curl, a modified client) by any DM. Without a server
// max, an oversized grid would broadcast room-wide via MAP_UPDATED and hang
// every connected client's `Array.from({length: columns*rows})` render.
export const upsertEncounterMapSchema = z.object({
  backgroundAssetId: z.string().uuid().nullable().optional(),
  gridColumns: z.number().int().min(5).max(50).optional(),
  gridRows: z.number().int().min(5).max(50).optional(),
  cellSizePx: z.number().int().min(10).max(200).optional(),
  // REFACTOR-PLAN.md §4 — distinct from cellSizePx (a pixel rendering
  // dimension, REFACTOR-PLAN.md §3's zoom work); this is the movement-math
  // ratio. See docs/rules/movement.md §2.1 for why the two must never be
  // conflated.
  feetPerCell: z.number().int().min(1).max(50).optional(),
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
// docs/rules/actions.md §2.3: object interaction is a fourth per-turn
// resource, not part of the action/bonus-action/reaction economy — but it's
// the same "spend one of my per-turn resources" shape as the other three,
// so it's a fourth enum member here rather than a parallel boolean flag
// (the column this maps to, ${spend}_used, already follows a uniform naming
// convention — see applyActionEconomy).
export const applyActionEconomySchema = z
  .object({
    spend: z.enum(['action', 'bonus_action', 'reaction', 'object_interaction']).optional(),
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

import { z } from 'zod';

export const diceRollTypeEnum = z.enum([
  'ability_check',
  'saving_throw',
  'skill_check',
  'attack',
  'initiative',
  'death_save',
  'custom',
  'damage',
]);

export const diceRollKeepEnum = z.enum(['normal', 'advantage', 'disadvantage']);

export const DICE_SIDES = [4, 6, 8, 10, 12, 20, 100] as const;
export const diceSidesEnum = z.union([
  z.literal(4), z.literal(6), z.literal(8), z.literal(10), z.literal(12), z.literal(20), z.literal(100),
]);

// Iteration 3 dice-engine rebuild §2.3/2.4 — net-new, not a bug fix. See the
// 1784269792666 migration's header comment for why this is scoped narrowly
// to dice_rolls and not a revival of the removed general hide/reveal engine.
export const diceRollVisibilityEnum = z.enum(['public', 'gm_only', 'private']);

// characterId/monsterInstanceId are independently optional, not mutually
// exclusive (see the migration's header comment / PLAN.md §3.5) — no
// .refine() forcing exactly one, unlike addParticipantSchema in
// schemas/encounters.ts.
export const createDiceRollSchema = z
  .object({
    rollType: diceRollTypeEnum,
    rollContext: z.string().min(1).max(200).optional().nullable(),
    // Defaults mirror the DB column defaults ('normal' / 0) — same permissive
    // "client may omit, server fills in the mechanically-neutral default"
    // convention as rollInitiativeSchema's `force: z.boolean().default(false)`
    // in schemas/encounters.ts.
    keep: diceRollKeepEnum.default('normal'),
    modifier: z.number().int().default(0),
    // Arbitrary-dice extension: diceSides/diceCount default to 20/1 (a plain
    // d20 check, identical to every pre-existing roll shape) — the frontend
    // sets these explicitly for quick-die buttons (d4/d6/.../d100) and for
    // parsed "NdM+K" expressions (parsed client-side into diceCount/
    // diceSides/modifier; the server never parses expression strings).
    diceSides: diceSidesEnum.default(20),
    diceCount: z.number().int().min(1).max(20).default(1),
    characterId: z.string().uuid().optional(),
    monsterInstanceId: z.string().uuid().optional(),
    encounterId: z.string().uuid().optional(),
    // Visibility tier — DM-only for anything but 'public' (services/
    // diceRolls.ts enforces this; "conditions/secrets are a DM tool" is this
    // app's existing convention, see ActionEconomyPanel.tsx's Dodge comment).
    visibility: diceRollVisibilityEnum.default('public'),
    visibleToUserId: z.string().uuid().optional(),
    // Manual entry (physical dice) — the exact raw die values the player
    // actually rolled at the table, still run through the SAME modifier/
    // crit/history path as a server-rolled one. Length must match what the
    // roll's own shape expects (diceCount for 'normal', always 2 for
    // advantage/disadvantage) — checked below, not left for the service to
    // silently truncate/pad. Each value must be a legal face of diceSides.
    manualRolls: z.array(z.number().int().min(1)).max(20).optional(),
    // Fulfills a GM-initiated roll request (services/diceRollRequests.ts) —
    // the server verifies this target row actually belongs to the caller
    // and is still pending before marking it rolled.
    fulfillsRequestTargetId: z.string().uuid().optional(),
  })
  // Advantage/disadvantage is a d20-only 5e concept (roll 2, keep one) — any
  // other die size always rolls `diceCount` independent dice with no
  // keep-highest/lowest semantics.
  .refine((v) => v.keep === 'normal' || v.diceSides === 20, {
    message: 'Advantage/disadvantage only applies to d20 rolls',
    path: ['keep'],
  })
  .refine((v) => v.visibility !== 'private' || v.visibleToUserId !== undefined, {
    message: 'A private roll must name who it is visible to',
    path: ['visibleToUserId'],
  })
  .refine((v) => v.visibility === 'private' || v.visibleToUserId === undefined, {
    message: 'visibleToUserId is only meaningful for a private roll',
    path: ['visibleToUserId'],
  })
  .refine(
    (v) => {
      if (v.manualRolls === undefined) return true;
      const expectedCount = v.keep === 'normal' ? v.diceCount : 2;
      return v.manualRolls.length === expectedCount;
    },
    { message: 'manualRolls must have exactly as many values as this roll would otherwise roll', path: ['manualRolls'] },
  )
  .refine((v) => v.manualRolls === undefined || v.manualRolls.every((r) => r <= v.diceSides), {
    message: 'manualRolls contains a value higher than diceSides allows',
    path: ['manualRolls'],
  });
export type CreateDiceRollInput = z.infer<typeof createDiceRollSchema>;

// First cursor-paginated endpoint in this codebase — cursor is an opaque,
// server-issued base64url token (see services/diceRolls.ts's
// encodeCursor/decodeCursor), so the client never constructs or parses it,
// just round-trips whatever `nextCursor` it was last given.
export const listDiceRollsQuerySchema = z.object({
  encounterId: z.string().uuid().optional(),
  // Roll log filterable by character (Iteration 3 §2.5) — matches
  // characterId on rolls made AS this character; a monster instance's rolls
  // are never mixed into this filter (no monsterInstanceId query param —
  // the roll log's character filter is a player-facing "my character's
  // rolls" convenience, not a DM monster-audit tool).
  characterId: z.string().uuid().optional(),
  cursor: z.string().min(1).optional(),
});
export type ListDiceRollsQuery = z.infer<typeof listDiceRollsQuerySchema>;

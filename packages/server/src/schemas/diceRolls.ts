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
  })
  // Advantage/disadvantage is a d20-only 5e concept (roll 2, keep one) — any
  // other die size always rolls `diceCount` independent dice with no
  // keep-highest/lowest semantics.
  .refine((v) => v.keep === 'normal' || v.diceSides === 20, {
    message: 'Advantage/disadvantage only applies to d20 rolls',
    path: ['keep'],
  });
export type CreateDiceRollInput = z.infer<typeof createDiceRollSchema>;

// First cursor-paginated endpoint in this codebase — cursor is an opaque,
// server-issued base64url token (see services/diceRolls.ts's
// encodeCursor/decodeCursor), so the client never constructs or parses it,
// just round-trips whatever `nextCursor` it was last given.
export const listDiceRollsQuerySchema = z.object({
  encounterId: z.string().uuid().optional(),
  cursor: z.string().min(1).optional(),
});
export type ListDiceRollsQuery = z.infer<typeof listDiceRollsQuerySchema>;

import { z } from 'zod';

// See src/schemas/characters.ts for why defaulted fields live only on the
// create schema: zod's `.partial()` does not strip `.default()`, so an
// update schema built directly from a schema with defaults would silently
// reintroduce them (e.g. status back to 'alive') whenever that key is
// omitted from a PATCH body.
const sharedMonsterInstanceShape = {
  monsterId: z.string().uuid(),
  customName: z.string().max(200).optional().nullable(),
  hpMaxOverride: z.number().int().positive().optional().nullable(),
  // Phase 3.5 (PLAN.md §3.5): the manual AC escape hatch for creature
  // instances, mirroring hpMaxOverride exactly — monster_instances never
  // gets an auto-recompute path (see services/armorClass.ts's top-of-file
  // scope note), so this flat override is the only way to deviate from the
  // catalog monsters.armor_class value.
  armorClassOverride: z.number().int().optional().nullable(),
  hpCurrent: z.number().int().min(0),
  hpTemp: z.number().int().min(0),
  status: z.enum(['alive', 'dead', 'fled', 'captured']),
  isRecurring: z.boolean(),
  notes: z.string().max(20000).optional().nullable(),
};

export const createMonsterInstanceSchema = z.object(sharedMonsterInstanceShape).extend({
  hpTemp: z.number().int().min(0).default(0),
  status: z.enum(['alive', 'dead', 'fled', 'captured']).default('alive'),
  isRecurring: z.boolean().default(false),
});
export type CreateMonsterInstanceInput = z.infer<typeof createMonsterInstanceSchema>;

export const updateMonsterInstanceSchema = z.object(sharedMonsterInstanceShape).partial();
export type UpdateMonsterInstanceInput = z.infer<typeof updateMonsterInstanceSchema>;

export const monsterInstanceHpDeltaSchema = z.object({
  delta: z.number().int().default(0),
  tempDelta: z.number().int().default(0),
});
export type MonsterInstanceHpDeltaInput = z.infer<typeof monsterInstanceHpDeltaSchema>;

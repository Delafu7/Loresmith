import { z } from 'zod';

export const editionQuerySchema = z.object({
  edition: z.enum(['2014', '2024', 'both']).optional(),
});
export type EditionQuery = z.infer<typeof editionQuerySchema>;

export const monsterQuerySchema = editionQuerySchema.extend({
  creatureType: z.string().optional(),
  crMin: z.coerce.number().optional(),
  crMax: z.coerce.number().optional(),
  // Optional filter added for Phase 3.2 (bestiary CRUD): supplying a
  // campaignId additionally unions in that campaign's homebrew monsters
  // (is_homebrew=true rows it owns) alongside the global catalog — same
  // pattern as effectDefinitionQuerySchema below. A campaignId-scoped read
  // MUST be gated behind requireMembership at the route (see
  // routes/catalog.ts) — never trust this query param alone.
  campaignId: z.string().uuid().optional(),
  // REFACTOR-PLAN.md §1: powers /bestiary/campaign/:id (campaign-specific
  // creatures only, no global-catalog union) — requires campaignId; ignored
  // otherwise. The default (no flag) keeps today's "global + this campaign's
  // homebrew" union behavior for every existing caller.
  homebrewOnly: z.coerce.boolean().optional(),
});
export type MonsterQuery = z.infer<typeof monsterQuerySchema>;

// Added alongside the Phase 2 UI work (spell/item libraries, effect
// picker) — PLAN.md §4.1 documents `GET /catalog/{...|spells|items|...}` as
// part of the catalog endpoint family, but the routes hadn't been built yet
// for these three resources. Same read-only, edition-filtered shape as every
// other catalog list above.
export const spellQuerySchema = editionQuerySchema.extend({
  classId: z.string().uuid().optional(),
});
export type SpellQuery = z.infer<typeof spellQuerySchema>;

export const itemQuerySchema = editionQuerySchema.extend({
  itemType: z.string().optional(),
});
export type ItemQuery = z.infer<typeof itemQuerySchema>;

// effect_definitions rows are either global (owning_campaign_id IS NULL) or
// homebrew scoped to one campaign (PLAN.md §3.2's CHECK (is_homebrew OR
// owning_campaign_id IS NULL)) — campaignId is optional so a caller with no
// campaign context yet still gets the global SRD-condition set.
export const effectDefinitionQuerySchema = z.object({
  campaignId: z.string().uuid().optional(),
});
export type EffectDefinitionQuery = z.infer<typeof effectDefinitionQuerySchema>;

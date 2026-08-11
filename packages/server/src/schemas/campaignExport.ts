// Phase 4: JSON campaign import/export. The export payload is (mostly) raw
// DB rows — same "no camelCase transform layer" convention every other GET
// endpoint in this API already uses — so this schema validates STRUCTURE
// (the right top-level sections, each row an object with a string id) not
// every individual column. Import re-inserts each row generically (see
// services/campaignImport.ts), so a column this schema doesn't know about
// still round-trips fine; only the handful of fields import actively
// remaps/regenerates need to be named here at all.

import { z } from 'zod';

// Any DB row: must carry the id import uses as the remap key, everything
// else passes through untyped (import's generic column-copy doesn't care
// what's on the row beyond the pieces it explicitly overrides/remaps).
const genericRow = z
  .object({ id: z.string().min(1) })
  .catchall(z.unknown());

// character_classes / character_saving_throw_proficiencies /
// character_skill_proficiencies have composite PKs (character_id + the
// other FK) and no standalone `id` column at all — import never needs to
// remap a reference *to* one of these rows (nothing else points at them),
// so unlike genericRow above, an id isn't required here.
const compositeKeyRow = z.record(z.string(), z.unknown());

const characterRowSchema = z
  .object({
    id: z.string().min(1),
    classes: z.array(compositeKeyRow).default([]),
    items: z.array(genericRow).default([]),
    attacks: z.array(genericRow).default([]),
    spells: z.array(genericRow).default([]),
    savingThrowProficiencies: z.array(compositeKeyRow).default([]),
    skillProficiencies: z.array(compositeKeyRow).default([]),
    resourcePools: z.array(genericRow).default([]),
    // character_currency (Phase 1.5) — PK is character_id itself, no
    // standalone `id` column, same shape as classes/proficiencies above.
    // At most one row (1:1 with the character); older (v1) exports simply
    // won't have this key, default([]) makes that a no-op import.
    currency: z.array(compositeKeyRow).default([]),
  })
  .catchall(z.unknown());

export const campaignExportSchema = z.object({
  formatVersion: z.number().int(),
  exportedAt: z.string(),
  campaign: z
    .object({
      name: z.string().min(1).max(200),
      srd_edition: z.enum(['2014', '2024']),
    })
    .catchall(z.unknown()),
  assets: z.array(genericRow).default([]),
  homebrewCatalog: z.object({
    alignments: z.array(genericRow).default([]),
    languages: z.array(genericRow).default([]),
    damage_types: z.array(genericRow).default([]),
    feats: z.array(genericRow).default([]),
    races: z.array(genericRow).default([]),
    subraces: z.array(genericRow).default([]),
    classes: z.array(genericRow).default([]),
    subclasses: z.array(genericRow).default([]),
    backgrounds: z.array(genericRow).default([]),
    items: z.array(genericRow).default([]),
    spells: z.array(genericRow).default([]),
    effect_definitions: z.array(genericRow).default([]),
  }),
  monsters: z.array(genericRow).default([]),
  characters: z.array(characterRowSchema).default([]),
  sessionLog: z.array(genericRow).default([]),
  notes: z.array(genericRow).default([]),
  // v3 (Operational "campaign export completeness") — default([]) makes
  // these a no-op import for any pre-v3 export payload.
  locations: z.array(genericRow).default([]),
  factions: z.array(genericRow).default([]),
  plotThreads: z.array(genericRow).default([]),
  campaignEvents: z.array(genericRow).default([]),
});
export type CampaignExportData = z.infer<typeof campaignExportSchema>;

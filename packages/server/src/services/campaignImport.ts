// Phase 4: JSON campaign import — the inverse of campaignExport.ts. Always
// creates a brand-new campaign (the user's own explicit scoping choice: this
// never overwrites/merges into an existing one), owned by the importing
// user, who becomes its DM. Every row gets a fresh id; internal
// cross-references (a character's raceId, a class's subclassId, a note's
// characterId, ...) are rewritten to match via a single old-id -> new-id
// map built up as rows are inserted, in dependency order, inside one
// transaction — either the whole campaign lands, or none of it does.
//
// A field NOT found in the id map is left untouched rather than treated as
// an error: that's exactly what a reference to GLOBAL catalog data (e.g. an
// ability_scores id, or a race the export never needed to fork because it
// wasn't homebrew) looks like — those ids are stable across the whole DB
// and never get remapped, by construction (nothing this import creates ever
// reuses one as a key).

import type { Pool, PoolClient } from 'pg';
import type { CampaignExportData } from '../schemas/campaignExport.js';

type Row = Record<string, unknown>;

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

// Global catalog tables (items, spells, races, ...) enforce uniqueness on
// their human-editable key GLOBALLY, not per-campaign (same reason
// catalogHomebrew.ts's createHomebrewCatalogRow suffixes it on create) — an
// import re-inserting a row's key verbatim would collide with the row still
// sitting in its *source* campaign. subraces/subclasses are keyed
// (parent_id, key) against a freshly-remapped parent id, so they can never
// collide even unsuffixed, but suffixing anyway costs nothing and matches
// what a DM forking the same content by hand through the UI would produce.
const KEY_COLUMN: Partial<Record<string, string>> = {
  items: 'slug',
  spells: 'slug',
  races: 'index_key',
  subraces: 'index_key',
  classes: 'index_key',
  subclasses: 'index_key',
  backgrounds: 'index_key',
  feats: 'index_key',
  alignments: 'index_key',
  languages: 'index_key',
  damage_types: 'index_key',
  monsters: 'slug',
};

const JSONB_COLUMNS: Record<string, Set<string>> = {
  campaigns: new Set(['reveal_defaults']),
  characters: new Set(['alt_speeds', 'hit_dice_remaining']),
  races: new Set(['ability_bonuses', 'traits']),
  subraces: new Set(['ability_bonuses', 'traits']),
  items: new Set(['properties']),
  spells: new Set(['damage_at_level']),
  backgrounds: new Set(['ability_bonus_choices']),
  monsters: new Set(['speed', 'saving_throws', 'skills', 'traits', 'actions', 'legendary_actions', 'reactions']),
};

function remapId(idMap: Map<string, string>, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return idMap.get(value) ?? value;
}

function remapIdArray(idMap: Map<string, string>, value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((v) => remapId(idMap, v));
}

// Generic "copy every source column except what's overridden/dropped,
// remapping the handful of FK-shaped fields that might point at a row this
// same import just re-created under a new id" — the same idiom
// duplicateCharacter/duplicateCatalogRow use for a same-shape copy, extended
// with the remap step an import (unlike a simple duplicate) needs.
async function insertRow(
  client: PoolClient,
  table: string,
  source: Row,
  options: {
    omit: Set<string>;
    overrides?: Row;
    remap?: Record<string, (value: unknown) => unknown>;
  },
): Promise<Row> {
  const jsonbColumns = JSONB_COLUMNS[table];
  const columns: string[] = [];
  const values: unknown[] = [];
  for (const [col, val] of Object.entries(source)) {
    if (options.omit.has(col) || col.endsWith('_legacy') || (options.overrides && col in options.overrides)) continue;
    let value = options.remap?.[col] ? options.remap[col]!(val) : val;
    if (jsonbColumns?.has(col) && value !== null && value !== undefined) value = JSON.stringify(value);
    columns.push(col);
    values.push(value);
  }
  for (const [col, val] of Object.entries(options.overrides ?? {})) {
    columns.push(col);
    values.push(val);
  }
  const placeholders = columns.map((_, i) => `$${i + 1}`);
  const result = await client.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
    values,
  );
  return result.rows[0];
}

// Inserts one homebrew-catalog-table row, suffixing its key column (if any)
// to dodge the table's global unique constraint, remapping it into the new
// campaign, and recording old id -> new id. `extraRemap` covers a table's
// one or two cross-homebrew FK fields (e.g. subraces.race_id) on top of the
// key-column suffix every homebrew row gets.
async function insertHomebrewCatalogRow(
  client: PoolClient,
  table: string,
  source: Row,
  newCampaignId: string,
  idMap: Map<string, string>,
  extraRemap: Record<string, (value: unknown) => unknown> = {},
): Promise<void> {
  const keyColumn = KEY_COLUMN[table];
  const remap: Record<string, (value: unknown) => unknown> = { ...extraRemap };
  if (keyColumn) remap[keyColumn] = (v) => `${String(v)}-${randomSuffix()}`;

  const inserted = await insertRow(client, table, source, {
    omit: new Set(['id', 'is_homebrew', 'owning_campaign_id', 'created_at', 'updated_at']),
    overrides: { is_homebrew: true, owning_campaign_id: newCampaignId },
    remap,
  });
  idMap.set(source.id as string, inserted.id as string);
}

export async function importCampaign(pool: Pool, actorId: string, data: CampaignExportData): Promise<{ campaignId: string }> {
  const idMap = new Map<string, string>();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const insertedCampaign = await insertRow(client, 'campaigns', data.campaign, {
      omit: new Set(['id', 'dm_user_id', 'created_at']),
      overrides: { dm_user_id: actorId },
    });
    const newCampaignId = insertedCampaign.id as string;
    await client.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [newCampaignId, actorId]);

    // ---- Assets (no dependencies) ----
    for (const row of data.assets) {
      const inserted = await insertRow(client, 'campaign_assets', row, {
        omit: new Set(['id', 'campaign_id', 'uploaded_by_user_id', 'created_at', 'updated_at']),
        overrides: { campaign_id: newCampaignId, uploaded_by_user_id: actorId },
      });
      idMap.set(row.id as string, inserted.id as string);
    }

    // ---- Locations & factions (no dependencies; inserted before session
    // log/notes so their location_id fields below can remap instead of
    // dropping the reference) ----
    for (const row of data.locations) {
      const inserted = await insertRow(client, 'locations', row, {
        omit: new Set(['id', 'campaign_id', 'created_at', 'updated_at']),
        overrides: { campaign_id: newCampaignId },
      });
      idMap.set(row.id as string, inserted.id as string);
    }
    for (const row of data.factions) {
      await insertRow(client, 'factions', row, {
        omit: new Set(['id', 'campaign_id', 'created_at', 'updated_at']),
        overrides: { campaign_id: newCampaignId },
      });
    }

    // ---- Homebrew catalog: tables with no cross-homebrew FK first ----
    for (const row of data.homebrewCatalog.alignments) await insertHomebrewCatalogRow(client, 'alignments', row, newCampaignId, idMap);
    for (const row of data.homebrewCatalog.languages) await insertHomebrewCatalogRow(client, 'languages', row, newCampaignId, idMap);
    for (const row of data.homebrewCatalog.damage_types) await insertHomebrewCatalogRow(client, 'damage_types', row, newCampaignId, idMap);
    for (const row of data.homebrewCatalog.feats) await insertHomebrewCatalogRow(client, 'feats', row, newCampaignId, idMap);
    for (const row of data.homebrewCatalog.races) await insertHomebrewCatalogRow(client, 'races', row, newCampaignId, idMap);
    for (const row of data.homebrewCatalog.classes) await insertHomebrewCatalogRow(client, 'classes', row, newCampaignId, idMap);
    for (const row of data.homebrewCatalog.spells) await insertHomebrewCatalogRow(client, 'spells', row, newCampaignId, idMap);
    for (const row of data.homebrewCatalog.effect_definitions) {
      await insertHomebrewCatalogRow(client, 'effect_definitions', row, newCampaignId, idMap);
    }

    // ---- Homebrew catalog: tables that reference the ones above ----
    for (const row of data.homebrewCatalog.subraces) {
      await insertHomebrewCatalogRow(client, 'subraces', row, newCampaignId, idMap, { race_id: (v) => remapId(idMap, v) });
    }
    for (const row of data.homebrewCatalog.subclasses) {
      await insertHomebrewCatalogRow(client, 'subclasses', row, newCampaignId, idMap, { class_id: (v) => remapId(idMap, v) });
    }
    for (const row of data.homebrewCatalog.backgrounds) {
      await insertHomebrewCatalogRow(client, 'backgrounds', row, newCampaignId, idMap, { granted_feat_id: (v) => remapId(idMap, v) });
    }
    for (const row of data.homebrewCatalog.items) {
      await insertHomebrewCatalogRow(client, 'items', row, newCampaignId, idMap, { damage_type_id: (v) => remapId(idMap, v) });
    }

    // ---- Homebrew monsters (may reference an imported asset) ----
    for (const row of data.monsters) {
      await insertHomebrewCatalogRow(client, 'monsters', row, newCampaignId, idMap, {
        art_asset_id: (v) => remapId(idMap, v),
        condition_immunity_ids: (v) => remapIdArray(idMap, v),
      });
    }

    // ---- Characters + every sub-resource table ----
    for (const character of data.characters) {
      const { classes, items, attacks, spells, savingThrowProficiencies, skillProficiencies, resourcePools, currency, ...characterRow } =
        character;

      // Imported characters — PCs and NPCs alike — always land unassigned.
      // The original owning player isn't necessarily (and usually isn't) a
      // member of the freshly-created campaign, and imported PCs must never
      // be auto-bound to the importing DM either: the DM assigns each PC to
      // its real player by email once they've joined (services/characters.ts
      // assignCharacterToPlayer). characters_check, which used to force a
      // non-null owner on every PC, was dropped for exactly this case
      // (1784269776666_relax-characters-owner-check.ts).
      const ownerUserId = null;
      const insertedCharacter = await insertRow(client, 'characters', characterRow, {
        omit: new Set(['id', 'campaign_id', 'created_by_user_id', 'owner_user_id', 'created_at', 'updated_at']),
        overrides: { campaign_id: newCampaignId, created_by_user_id: actorId, owner_user_id: ownerUserId },
        remap: {
          race_id: (v) => remapId(idMap, v),
          subrace_id: (v) => remapId(idMap, v),
          background_id: (v) => remapId(idMap, v),
          portrait_asset_id: (v) => remapId(idMap, v),
          languages: (v) => remapIdArray(idMap, v),
        },
      });
      const newCharacterId = insertedCharacter.id as string;
      idMap.set(character.id, newCharacterId);

      for (const row of classes as Row[]) {
        await insertRow(client, 'character_classes', row, {
          omit: new Set(['character_id']),
          overrides: { character_id: newCharacterId },
          remap: { class_id: (v) => remapId(idMap, v), subclass_id: (v) => remapId(idMap, v) },
        });
      }
      for (const row of items as Row[]) {
        // monster_instance_id is never populated on a character-scoped row
        // (character_items_check requires exactly one of character_id/
        // monster_instance_id) and monster_instances aren't part of this
        // export's scope anyway — omit it, character_id alone satisfies the
        // check.
        await insertRow(client, 'character_items', row, {
          omit: new Set(['id', 'character_id', 'monster_instance_id']),
          overrides: { character_id: newCharacterId },
          remap: { item_id: (v) => remapId(idMap, v) },
        });
      }
      for (const row of attacks as Row[]) {
        await insertRow(client, 'character_attacks', row, {
          omit: new Set(['id', 'character_id', 'created_at']),
          overrides: { character_id: newCharacterId },
        });
      }
      for (const row of spells as Row[]) {
        await insertRow(client, 'character_spells', row, {
          omit: new Set(['id', 'character_id']),
          overrides: { character_id: newCharacterId },
          remap: { class_id: (v) => remapId(idMap, v), spell_id: (v) => remapId(idMap, v) },
        });
      }
      for (const row of savingThrowProficiencies as Row[]) {
        await insertRow(client, 'character_saving_throw_proficiencies', row, {
          omit: new Set(['character_id']),
          overrides: { character_id: newCharacterId },
        });
      }
      for (const row of skillProficiencies as Row[]) {
        await insertRow(client, 'character_skill_proficiencies', row, {
          omit: new Set(['character_id']),
          overrides: { character_id: newCharacterId },
        });
      }
      for (const row of resourcePools as Row[]) {
        await insertRow(client, 'character_resource_pools', row, {
          omit: new Set(['id', 'character_id']),
          overrides: { character_id: newCharacterId },
        });
      }
      // At most one row (1:1, PK = character_id) — absent on a v1 export
      // (schemas/campaignExport.ts defaults it to []), nothing to insert.
      for (const row of currency as Row[]) {
        await insertRow(client, 'character_currency', row, {
          omit: new Set(['character_id']),
          overrides: { character_id: newCharacterId },
        });
      }
    }

    // ---- Session log ----
    for (const row of data.sessionLog) {
      // location_id (Phase 3 "locations and factions") now remaps against
      // the locations already inserted above (v3 export/import); a null
      // value or a pre-v3 export (no locations section) passes through
      // remapId unchanged, same as any other id not in the map.
      const inserted = await insertRow(client, 'sessions', row, {
        omit: new Set(['id', 'campaign_id', 'created_at', 'updated_at']),
        overrides: { campaign_id: newCampaignId },
        remap: { location_id: (v) => remapId(idMap, v) },
      });
      idMap.set(row.id as string, inserted.id as string);
    }

    // ---- Notes (may reference an imported character, session, and/or location) ----
    for (const row of data.notes) {
      // search_vector (Phase 3 "full-text search on notes") is a GENERATED
      // ALWAYS column — Postgres rejects an explicit INSERT into it, same
      // reason duplicateNote (services/notes.ts) omits it. The exported row
      // carries it (a plain SELECT * at export time), so it must be dropped
      // here rather than at export — the export payload is otherwise meant
      // to be close-to-raw.
      await insertRow(client, 'notes', row, {
        omit: new Set(['id', 'campaign_id', 'author_user_id', 'created_at', 'updated_at', 'search_vector']),
        overrides: { campaign_id: newCampaignId, author_user_id: actorId },
        remap: {
          character_id: (v) => remapId(idMap, v),
          session_id: (v) => remapId(idMap, v),
          location_id: (v) => remapId(idMap, v),
        },
      });
    }

    // ---- Plot threads (may reference an imported session) ----
    for (const row of data.plotThreads) {
      // entity_visibility grants aren't exported/imported (see
      // campaignExport.ts's format-version comment) — a thread lands DM-only
      // until the new campaign's DM re-shares it, same as how an imported
      // PC lands unassigned rather than auto-bound to a stale player.
      await insertRow(client, 'plot_threads', row, {
        omit: new Set(['id', 'campaign_id', 'created_at']),
        overrides: { campaign_id: newCampaignId },
        remap: { origin_session_id: (v) => remapId(idMap, v) },
      });
    }

    // ---- Campaign calendar events (no dependencies) ----
    for (const row of data.campaignEvents) {
      await insertRow(client, 'campaign_events', row, {
        omit: new Set(['id', 'campaign_id', 'created_at']),
        overrides: { campaign_id: newCampaignId },
      });
    }

    await client.query('COMMIT');
    return { campaignId: newCampaignId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Integration test for Phase 4 (JSON campaign import/export): builds a
// source campaign touching every remap case export/import has to get right
// — a homebrew race + subrace (cross-homebrew FK), a homebrew class +
// subclass, a homebrew damage type + item (cross-homebrew FK), a homebrew
// feat + background (cross-homebrew FK), a homebrew monster referencing a
// campaign asset, a character referencing homebrew race/subrace/background/
// portrait asset plus GLOBAL ability-score/skill ids, a note referencing
// both a character and a session log entry — then exports it, imports the
// export as a different user, and asserts every cross-reference in the new
// campaign resolves correctly while every global-catalog reference (which
// must NOT be remapped) stays byte-identical. Throwaway fixtures, same
// isolation convention as monsterCatalog.duplicate.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { exportCampaign } from './campaignExport.js';
import { importCampaign } from './campaignImport.js';
import { createHomebrewCatalogRow } from './catalogHomebrew.js';
import { createHomebrewMonster } from './monsterCatalog.js';
import { campaignExportSchema } from '../schemas/campaignExport.js';

describe('exportCampaign + importCampaign (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let importerUserId: string;
  let campaignId: string;
  let abilityScoreId: string;
  let skillId: string;
  let assetId: string;
  let raceId: string;
  let subraceId: string;
  let languageId: string;
  let classId: string;
  let subclassId: string;
  let damageTypeId: string;
  let itemId: string;
  let featId: string;
  let backgroundId: string;
  let characterId: string;
  let sessionId: string;

  const createdCampaignIds: string[] = [];

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Export DM', 'x') RETURNING id`,
      [`export-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const importerRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Import User', 'x') RETURNING id`,
      [`import-user-${suffix}@example.test`],
    );
    importerUserId = importerRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Export Source Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    createdCampaignIds.push(campaignId);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);

    abilityScoreId = (await pool.query<{ id: string }>(`SELECT id FROM ability_scores ORDER BY id ASC LIMIT 1`)).rows[0]!.id;
    skillId = (await pool.query<{ id: string }>(`SELECT id FROM skills ORDER BY id ASC LIMIT 1`)).rows[0]!.id;

    const assetRes = await pool.query<{ id: string }>(
      `INSERT INTO campaign_assets (campaign_id, uploaded_by_user_id, asset_type, file_url, mime_type, file_size_bytes, title)
       VALUES ($1, $2, 'image', '/uploads/test.png', 'image/png', 100, 'Test Portrait') RETURNING id`,
      [campaignId, dmUserId],
    );
    assetId = assetRes.rows[0]!.id;

    const raceJsonbColumns = new Set(['ability_bonuses', 'traits']);
    const race = await createHomebrewCatalogRow(
      pool, dmUserId, campaignId, { table: 'races', keyColumn: 'index_key', jsonbColumns: raceJsonbColumns },
      {
        index_key: 'export-test-race', name: 'Export Test Race', edition_scope: 'both', speed: 30, size: 'medium',
        ability_bonuses: { str: 1 }, traits: [{ name: 'Test Trait' }],
      },
    );
    raceId = race.id as string;

    const subrace = await createHomebrewCatalogRow(
      pool, dmUserId, campaignId, { table: 'subraces', keyColumn: 'index_key', jsonbColumns: raceJsonbColumns },
      {
        race_id: raceId, index_key: 'export-test-subrace', name: 'Export Test Subrace',
        ability_bonuses: { dex: 1 }, traits: [],
      },
    );
    subraceId = subrace.id as string;

    const cls = await createHomebrewCatalogRow(pool, dmUserId, campaignId, { table: 'classes', keyColumn: 'index_key' }, {
      index_key: 'export-test-class', name: 'Export Test Class', edition_scope: 'both', hit_die: 8, spellcasting_type: 'none',
    });
    classId = cls.id as string;

    const subclass = await createHomebrewCatalogRow(pool, dmUserId, campaignId, { table: 'subclasses', keyColumn: 'index_key' }, {
      class_id: classId, index_key: 'export-test-subclass', name: 'Export Test Subclass',
    });
    subclassId = subclass.id as string;

    const language = await createHomebrewCatalogRow(pool, dmUserId, campaignId, { table: 'languages', keyColumn: 'index_key' }, {
      index_key: 'export-test-language', name: 'Export Test Language', edition_scope: 'both',
    });
    languageId = language.id as string;

    const damageType = await createHomebrewCatalogRow(pool, dmUserId, campaignId, { table: 'damage_types', keyColumn: 'index_key' }, {
      index_key: 'export-test-damage', name: 'Export Test Damage',
    });
    damageTypeId = damageType.id as string;

    const item = await createHomebrewCatalogRow(pool, dmUserId, campaignId, { table: 'items', keyColumn: 'slug' }, {
      slug: 'export-test-item', name: 'Export Test Item', edition_scope: 'both', item_type: 'weapon', rarity: 'common',
      requires_attunement: false, stealth_disadvantage: false, damage_type_id: damageTypeId,
    });
    itemId = item.id as string;

    const feat = await createHomebrewCatalogRow(pool, dmUserId, campaignId, { table: 'feats', keyColumn: 'index_key' }, {
      index_key: 'export-test-feat', name: 'Export Test Feat', edition_scope: 'both', description: 'A test feat.',
    });
    featId = feat.id as string;

    const background = await createHomebrewCatalogRow(pool, dmUserId, campaignId, { table: 'backgrounds', keyColumn: 'index_key' }, {
      index_key: 'export-test-background', name: 'Export Test Background', edition_scope: 'both', granted_feat_id: featId,
    });
    backgroundId = background.id as string;

    await createHomebrewMonster(pool, campaignId, dmUserId, {
      name: 'Export Test Monster', size: 'medium', creatureType: 'beast', armorClass: 12, hitPointAverage: 10,
      hitDice: '2d8', speed: { walk: 30 }, str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
      challengeRating: 1, xpValue: 200, actions: [{ name: 'Bite', description: '1d4 piercing.' }], artAssetId: assetId,
    });

    const characterRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, race_id, subrace_id, background_id, portrait_asset_id,
          str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current, hp_temp, exhaustion_level, languages)
       VALUES ($1,true,$2,$2,'Export Test Character',$3,$4,$5,$6,10,10,10,10,10,10,10,30,10,10,0,0,$7)
       RETURNING id`,
      [campaignId, dmUserId, raceId, subraceId, backgroundId, assetId, [languageId]],
    );
    characterId = characterRes.rows[0]!.id;

    await pool.query(
      `INSERT INTO character_classes (character_id, class_id, subclass_id, level) VALUES ($1,$2,$3,3)`,
      [characterId, classId, subclassId],
    );
    await pool.query(
      `INSERT INTO character_items (character_id, item_id, quantity) VALUES ($1,$2,1)`,
      [characterId, itemId],
    );
    await pool.query(
      `INSERT INTO character_attacks (character_id, name, attack_bonus, damage_dice, half_on_save, sort_order)
       VALUES ($1,'Test Attack',5,'1d6',false,0)`,
      [characterId],
    );
    await pool.query(
      `INSERT INTO character_saving_throw_proficiencies (character_id, ability_score_id) VALUES ($1,$2)`,
      [characterId, abilityScoreId],
    );
    await pool.query(
      `INSERT INTO character_skill_proficiencies (character_id, skill_id, level) VALUES ($1,$2,'proficient')`,
      [characterId, skillId],
    );
    await pool.query(
      `INSERT INTO character_resource_pools (character_id, resource_key, current_value, max_value, recharge_on)
       VALUES ($1,'ki',3,3,'short_rest')`,
      [characterId],
    );

    const sessionRes = await pool.query<{ id: string }>(
      `INSERT INTO sessions (campaign_id, session_number, title, recap) VALUES ($1,1,'Session One','It happened.') RETURNING id`,
      [campaignId],
    );
    sessionId = sessionRes.rows[0]!.id;

    await pool.query(
      `INSERT INTO notes (campaign_id, author_user_id, title, body, character_id, session_id)
       VALUES ($1,$2,'Export Test Note','Body text.',$3,$4)`,
      [campaignId, dmUserId, characterId, sessionId],
    );
  });

  afterAll(async () => {
    for (const id of createdCampaignIds) {
      await pool.query(`DELETE FROM campaigns WHERE id = $1`, [id]);
    }
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[dmUserId, importerUserId]]);
  });

  it('exports every section with cross-references pointing at rows within the export', async () => {
    const data = await exportCampaign(pool, campaignId);
    expect(data.formatVersion).toBe(1);
    expect(data.campaign.name).toBe('Export Source Campaign');
    expect(data.homebrewCatalog.races).toHaveLength(1);
    expect(data.homebrewCatalog.subraces[0]!.race_id).toBe(raceId);
    expect(data.homebrewCatalog.items[0]!.damage_type_id).toBe(damageTypeId);
    expect(data.homebrewCatalog.backgrounds[0]!.granted_feat_id).toBe(featId);
    expect(data.monsters[0]!.art_asset_id).toBe(assetId);
    expect(data.characters).toHaveLength(1);
    expect(data.characters[0]!.race_id).toBe(raceId);
    expect(data.characters[0]!.classes).toHaveLength(1);
    expect(data.notes[0]!.character_id).toBe(characterId);
    expect(data.notes[0]!.session_id).toBe(sessionId);

    // Round-trips through the same Zod schema importCampaign validates against.
    expect(() => campaignExportSchema.parse(data)).not.toThrow();
  });

  it('imports into a brand-new campaign with every cross-reference remapped and global ids left untouched', async () => {
    const data = await exportCampaign(pool, campaignId);
    const { campaignId: newCampaignId } = await importCampaign(pool, importerUserId, data);
    createdCampaignIds.push(newCampaignId);

    expect(newCampaignId).not.toBe(campaignId);

    const memberRes = await pool.query(
      `SELECT role FROM campaign_members WHERE campaign_id = $1 AND user_id = $2`,
      [newCampaignId, importerUserId],
    );
    expect(memberRes.rows[0]?.role).toBe('dm');

    const newRace = (await pool.query(`SELECT * FROM races WHERE owning_campaign_id = $1`, [newCampaignId])).rows[0];
    expect(newRace.id).not.toBe(raceId);
    expect(newRace.index_key).not.toBe('export-test-race');
    expect(newRace.index_key).toMatch(/^export-test-race-/);

    const newSubrace = (await pool.query(`SELECT * FROM subraces WHERE owning_campaign_id = $1`, [newCampaignId])).rows[0];
    expect(newSubrace.race_id).toBe(newRace.id); // remapped to the NEW race, not the old one

    const newDamageType = (await pool.query(`SELECT * FROM damage_types WHERE owning_campaign_id = $1`, [newCampaignId])).rows[0];
    const newItem = (await pool.query(`SELECT * FROM items WHERE owning_campaign_id = $1`, [newCampaignId])).rows[0];
    expect(newItem.damage_type_id).toBe(newDamageType.id);

    const newFeat = (await pool.query(`SELECT * FROM feats WHERE owning_campaign_id = $1`, [newCampaignId])).rows[0];
    const newBackground = (await pool.query(`SELECT * FROM backgrounds WHERE owning_campaign_id = $1`, [newCampaignId])).rows[0];
    expect(newBackground.granted_feat_id).toBe(newFeat.id);

    const newAsset = (await pool.query(`SELECT * FROM campaign_assets WHERE campaign_id = $1`, [newCampaignId])).rows[0];
    expect(newAsset.id).not.toBe(assetId);
    expect(newAsset.uploaded_by_user_id).toBe(importerUserId);

    const newMonster = (await pool.query(`SELECT * FROM monsters WHERE owning_campaign_id = $1`, [newCampaignId])).rows[0];
    expect(newMonster.art_asset_id).toBe(newAsset.id); // remapped to the NEW asset

    const newCharacter = (await pool.query(`SELECT * FROM characters WHERE campaign_id = $1`, [newCampaignId])).rows[0];
    expect(newCharacter.id).not.toBe(characterId);
    expect(newCharacter.race_id).toBe(newRace.id);
    expect(newCharacter.subrace_id).toBe(newSubrace.id);
    expect(newCharacter.background_id).toBe(newBackground.id);
    expect(newCharacter.portrait_asset_id).toBe(newAsset.id);
    expect(newCharacter.created_by_user_id).toBe(importerUserId);
    // Imported PCs land unassigned — never auto-bound to the importing DM —
    // since the original owner isn't a member of the new campaign and must
    // be attached later by email (assignCharacterToPlayer). This is allowed
    // now that characters_check no longer requires a non-null owner on every
    // PC (1784269776666_relax-characters-owner-check.ts).
    expect(newCharacter.owner_user_id).toBeNull();

    const newLanguage = (await pool.query(`SELECT * FROM languages WHERE owning_campaign_id = $1`, [newCampaignId])).rows[0];
    expect(newCharacter.languages).toEqual([newLanguage.id]); // array FK remapped, not left pointing at the old language

    const newClass = (await pool.query(`SELECT * FROM classes WHERE owning_campaign_id = $1`, [newCampaignId])).rows[0];
    const newSubclass = (await pool.query(`SELECT * FROM subclasses WHERE owning_campaign_id = $1`, [newCampaignId])).rows[0];
    const newCharClass = (await pool.query(`SELECT * FROM character_classes WHERE character_id = $1`, [newCharacter.id])).rows[0];
    expect(newCharClass.class_id).toBe(newClass.id);
    expect(newCharClass.subclass_id).toBe(newSubclass.id);

    const newCharItem = (await pool.query(`SELECT * FROM character_items WHERE character_id = $1`, [newCharacter.id])).rows[0];
    expect(newCharItem.item_id).toBe(newItem.id);
    expect(newCharItem.monster_instance_id).toBeNull();

    // Global-catalog references must be byte-identical, never remapped.
    const newSavingThrow = (
      await pool.query(`SELECT * FROM character_saving_throw_proficiencies WHERE character_id = $1`, [newCharacter.id])
    ).rows[0];
    expect(newSavingThrow.ability_score_id).toBe(abilityScoreId);
    const newSkill = (await pool.query(`SELECT * FROM character_skill_proficiencies WHERE character_id = $1`, [newCharacter.id])).rows[0];
    expect(newSkill.skill_id).toBe(skillId);

    const newResourcePool = (await pool.query(`SELECT * FROM character_resource_pools WHERE character_id = $1`, [newCharacter.id])).rows[0];
    expect(newResourcePool.resource_key).toBe('ki');

    const newSession = (await pool.query(`SELECT * FROM sessions WHERE campaign_id = $1`, [newCampaignId])).rows[0];
    expect(newSession.id).not.toBe(sessionId);
    expect(newSession.recap).toBe('It happened.');

    const newNote = (await pool.query(`SELECT * FROM notes WHERE campaign_id = $1`, [newCampaignId])).rows[0];
    expect(newNote.character_id).toBe(newCharacter.id);
    expect(newNote.session_id).toBe(newSession.id);
    expect(newNote.author_user_id).toBe(importerUserId);

    // Source campaign is completely untouched by the import.
    const sourceRace = (await pool.query(`SELECT * FROM races WHERE id = $1`, [raceId])).rows[0];
    expect(sourceRace.owning_campaign_id).toBe(campaignId);
    const sourceCharacterStillThere = (await pool.query(`SELECT * FROM characters WHERE id = $1`, [characterId])).rows[0];
    expect(sourceCharacterStillThere).toBeDefined();
  });

  it('rejects an import payload that fails schema validation without side effects', async () => {
    await expect(
      importCampaign(pool, importerUserId, { formatVersion: 1 } as never),
    ).rejects.toThrow();
  });
});

// Integration tests for docs/roadmap/dnd-2024-gap-analysis.md P1-2
// (auto-apply species/background mechanical grants at character creation) —
// scoped, per the plan confirmed with the user, to what the catalog can
// fully answer without an unmodeled player choice or missing schema:
// ability-score bonus (2014 race/subrace, fixed), speed, darkvision-derived
// senses text, background skill proficiencies, and a background's granted
// feat. Same throwaway-fixture isolation convention as
// characters.applyDamage.integration.test.ts; catalog row ids are looked up
// by index_key rather than hardcoded, so this survives a reseed.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { createCharacter } from './characters.js';
import type { CreateCharacterInput } from '../schemas/characters.js';

describe('species/background creation grants (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let dwarf2014RaceId: string;
  let hillDwarfSubraceId: string;
  let acolyte2024BackgroundId: string;
  let insightSkillId: string;
  let religionSkillId: string;
  let magicInitiateFeatId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Grants Test DM', 'x') RETURNING id`,
      [`grants-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Grants Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);

    dwarf2014RaceId = (
      await pool.query<{ id: string }>(`SELECT id FROM races WHERE index_key = 'dwarf' AND edition_scope = '2014'`)
    ).rows[0]!.id;
    hillDwarfSubraceId = (
      await pool.query<{ id: string }>(`SELECT id FROM subraces WHERE race_id = $1 AND index_key = 'hill-dwarf'`, [dwarf2014RaceId])
    ).rows[0]!.id;
    acolyte2024BackgroundId = (
      await pool.query<{ id: string }>(`SELECT id FROM backgrounds WHERE index_key = 'acolyte' AND edition_scope = '2024'`)
    ).rows[0]!.id;
    const skillRows = await pool.query<{ index_key: string; id: string }>(
      `SELECT index_key, id FROM skills WHERE index_key IN ('insight', 'religion')`,
    );
    insightSkillId = skillRows.rows.find((r) => r.index_key === 'insight')!.id;
    religionSkillId = skillRows.rows.find((r) => r.index_key === 'religion')!.id;
    magicInitiateFeatId = (
      await pool.query<{ id: string }>(`SELECT id FROM feats WHERE index_key = 'magic-initiate' LIMIT 1`)
    ).rows[0]!.id;
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  function baseInput(overrides: Partial<CreateCharacterInput> = {}): CreateCharacterInput {
    return {
      name: 'Grants Test PC',
      isPc: true,
      str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
      armorClass: 12,
      hpMax: 10,
      hpTemp: 0,
      exhaustionLevel: 0,
      damageResistances: [],
      damageVulnerabilities: [],
      damageImmunities: [],
      ...overrides,
    } as CreateCharacterInput;
  }

  it('a 2014 race with a fixed ability bonus adds it on top of the submitted base score', async () => {
    const character = await createCharacter(pool, dmUserId, campaignId, 'dm', baseInput({ raceId: dwarf2014RaceId }));
    expect(character.con).toBe(12); // 10 base + Dwarf's fixed CON+2
    expect(character.str).toBe(10);
    expect(character.wis).toBe(10);
  });

  it('race + subrace bonuses stack', async () => {
    const character = await createCharacter(
      pool,
      dmUserId,
      campaignId,
      'dm',
      baseInput({ raceId: dwarf2014RaceId, subraceId: hillDwarfSubraceId }),
    );
    expect(character.con).toBe(12); // race: CON+2
    expect(character.wis).toBe(11); // subrace: Hill Dwarf WIS+1
  });

  it('speed is pre-filled from the race catalog when the client omits it', async () => {
    const character = await createCharacter(pool, dmUserId, campaignId, 'dm', baseInput({ raceId: dwarf2014RaceId }));
    expect(character.speed).toBe(25); // Dwarf's catalog speed, not the generic 30 default
  });

  it('an explicit client-supplied speed overrides the race catalog value', async () => {
    const character = await createCharacter(pool, dmUserId, campaignId, 'dm', baseInput({ raceId: dwarf2014RaceId, speed: 99 }));
    expect(character.speed).toBe(99);
  });

  it('darkvision is derived into senses when the client omits it', async () => {
    const character = await createCharacter(pool, dmUserId, campaignId, 'dm', baseInput({ raceId: dwarf2014RaceId }));
    expect(character.senses).toBe('Darkvision 60 ft.');
  });

  it('an explicit client-supplied senses value is never clobbered by the darkvision auto-fill', async () => {
    const character = await createCharacter(
      pool,
      dmUserId,
      campaignId,
      'dm',
      baseInput({ raceId: dwarf2014RaceId, senses: 'Blindsight 10 ft.' }),
    );
    expect(character.senses).toBe('Blindsight 10 ft.');
  });

  it('no raceId at all leaves speed/senses/ability scores exactly as submitted (no regression)', async () => {
    const character = await createCharacter(pool, dmUserId, campaignId, 'dm', baseInput());
    expect(character.speed).toBe(30);
    expect(character.senses).toBeNull();
    expect(character.con).toBe(10);
  });

  it('a 2024 background grants its skill proficiencies and its Origin feat at creation', async () => {
    const character = await createCharacter(
      pool,
      dmUserId,
      campaignId,
      'dm',
      baseInput({ backgroundId: acolyte2024BackgroundId }),
    );
    const skills = await pool.query<{ skill_id: string; level: string }>(
      `SELECT skill_id, level FROM character_skill_proficiencies WHERE character_id = $1`,
      [character.id],
    );
    const skillIds = skills.rows.map((r) => r.skill_id).sort();
    expect(skillIds).toEqual([insightSkillId, religionSkillId].sort());
    expect(skills.rows.every((r) => r.level === 'proficient')).toBe(true);

    const feats = await pool.query<{ feat_id: string }>(`SELECT feat_id FROM character_feats WHERE character_id = $1`, [
      character.id,
    ]);
    expect(feats.rows.map((r) => r.feat_id)).toEqual([magicInitiateFeatId]);
  });

  it('a 2024 background does NOT auto-apply an ability-score bonus (no player-choice input exists yet)', async () => {
    const character = await createCharacter(
      pool,
      dmUserId,
      campaignId,
      'dm',
      baseInput({ backgroundId: acolyte2024BackgroundId, int: 14, wis: 12, cha: 8 }),
    );
    expect(character.int).toBe(14);
    expect(character.wis).toBe(12);
    expect(character.cha).toBe(8);
  });

  it('no backgroundId at all grants no skills or feats', async () => {
    const character = await createCharacter(pool, dmUserId, campaignId, 'dm', baseInput());
    const skills = await pool.query(`SELECT 1 FROM character_skill_proficiencies WHERE character_id = $1`, [character.id]);
    const feats = await pool.query(`SELECT 1 FROM character_feats WHERE character_id = $1`, [character.id]);
    expect(skills.rowCount).toBe(0);
    expect(feats.rowCount).toBe(0);
  });
});

// docs/roadmap/dnd-2024-gap-analysis.md P1-7 (SP-03) — the prepared-spell
// cap ("class level + spellcasting ability modifier, min 1") on
// learnCharacterSpell/toggleCharacterSpellPrepared. Throwaway fixture style,
// live DB — same isolation convention as weaponMastery.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { AppError } from '../middleware/errors.js';
import { learnCharacterSpell, toggleCharacterSpellPrepared, unlearnCharacterSpell } from './characterSpells.js';

describe('prepared-spell cap (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let wizardCharacterId: string; // Wizard 1, INT 16 (mod +3) -> cap 1+3=4
  let lowIntWizardCharacterId: string; // Wizard 1, INT 8 (mod -1) -> cap max(1, 1-1)=1
  let fighterCharacterId: string; // non-caster class, has a class_id row anyway
  let wizardClassId: string;
  let fighterClassId: string;
  const level1SpellIds: Record<string, string> = {};
  let cantripId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'PreparedCap Test DM', 'x') RETURNING id`,
      [`prepared-cap-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('PreparedCap Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);

    const mkCharacter = async (name: string, intScore: number) => {
      const res = await pool.query<{ id: string }>(
        `INSERT INTO characters
           (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
         VALUES ($1, true, $2, $2, $3, 10, 10, 10, $4, 10, 10, 12, 30, 10, 10)
         RETURNING id`,
        [campaignId, dmUserId, name, intScore],
      );
      return res.rows[0]!.id;
    };
    wizardCharacterId = await mkCharacter('PreparedCap Test Wizard', 16);
    lowIntWizardCharacterId = await mkCharacter('PreparedCap Test Low-INT Wizard', 8);
    fighterCharacterId = await mkCharacter('PreparedCap Test Fighter', 10);

    const wizardClass = await pool.query<{ id: string }>(`SELECT id FROM classes WHERE index_key = 'wizard' AND edition_scope = '2024'`);
    wizardClassId = wizardClass.rows[0]!.id;
    const fighterClass = await pool.query<{ id: string }>(`SELECT id FROM classes WHERE index_key = 'fighter' AND edition_scope = '2024'`);
    fighterClassId = fighterClass.rows[0]!.id;

    await pool.query(`INSERT INTO character_classes (character_id, class_id, level) VALUES ($1, $2, 1)`, [wizardCharacterId, wizardClassId]);
    await pool.query(`INSERT INTO character_classes (character_id, class_id, level) VALUES ($1, $2, 1)`, [lowIntWizardCharacterId, wizardClassId]);
    await pool.query(`INSERT INTO character_classes (character_id, class_id, level) VALUES ($1, $2, 1)`, [fighterCharacterId, fighterClassId]);

    const level1Slugs = ['bless', 'charm-person', 'command', 'compelled-duel', 'cure-wounds', 'guiding-bolt'];
    const level1Res = await pool.query<{ slug: string; id: string }>(`SELECT slug, id FROM spells WHERE slug = ANY($1)`, [level1Slugs]);
    for (const row of level1Res.rows) level1SpellIds[row.slug] = row.id;
    expect(Object.keys(level1SpellIds)).toHaveLength(6);

    const cantripRes = await pool.query<{ id: string }>(`SELECT id FROM spells WHERE slug = 'fire-bolt'`);
    cantripId = cantripRes.rows[0]!.id;
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  it('a level-1 Wizard with INT 16 (mod +3) can prepare exactly 4 level-1+ spells', async () => {
    const slugs = ['bless', 'charm-person', 'command', 'compelled-duel'];
    for (const slug of slugs) {
      const row = await learnCharacterSpell(pool, dmUserId, wizardCharacterId, {
        spellId: level1SpellIds[slug]!,
        classId: wizardClassId,
        isPrepared: true,
        alwaysPrepared: false,
        source: 'class',
      });
      expect(row.is_prepared).toBe(true);
    }
  });

  it('a 5th prepared spell exceeds the cap and is rejected', async () => {
    await expect(
      learnCharacterSpell(pool, dmUserId, wizardCharacterId, {
        spellId: level1SpellIds['cure-wounds']!,
        classId: wizardClassId,
        isPrepared: true,
        alwaysPrepared: false,
        source: 'class',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('learning the same spell unprepared succeeds (only preparing counts against the cap)', async () => {
    const row = await learnCharacterSpell(pool, dmUserId, wizardCharacterId, {
      spellId: level1SpellIds['cure-wounds']!,
      classId: wizardClassId,
      isPrepared: false,
      alwaysPrepared: false,
      source: 'class',
    });
    expect(row.is_prepared).toBe(false);
  });

  it('toggling that spell to prepared still fails while at the cap', async () => {
    await expect(
      toggleCharacterSpellPrepared(pool, dmUserId, wizardCharacterId, level1SpellIds['cure-wounds']!, wizardClassId, { isPrepared: true }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('un-preparing one spell frees a slot for another', async () => {
    await toggleCharacterSpellPrepared(pool, dmUserId, wizardCharacterId, level1SpellIds['bless']!, wizardClassId, { isPrepared: false });
    const result = await toggleCharacterSpellPrepared(
      pool, dmUserId, wizardCharacterId, level1SpellIds['cure-wounds']!, wizardClassId, { isPrepared: true },
    );
    expect(result.is_prepared).toBe(true);
  });

  it('re-toggling an already-prepared spell to prepared again does not double-count itself', async () => {
    const result = await toggleCharacterSpellPrepared(
      pool, dmUserId, wizardCharacterId, level1SpellIds['command']!, wizardClassId, { isPrepared: true },
    );
    expect(result.is_prepared).toBe(true);
  });

  it('cantrips (level 0) never count against the cap', async () => {
    const row = await learnCharacterSpell(pool, dmUserId, wizardCharacterId, {
      spellId: cantripId,
      classId: wizardClassId,
      isPrepared: true,
      alwaysPrepared: false,
      source: 'class',
    });
    expect(row.is_prepared).toBe(true);
  });

  it('always-prepared spells never count against the cap, even beyond it', async () => {
    // The Wizard is already at its cap (4) from the tests above — this must
    // succeed anyway, since always_prepared spells are additional, per the
    // "Always-Prepared Spells" rule.
    const row = await learnCharacterSpell(pool, dmUserId, wizardCharacterId, {
      spellId: level1SpellIds['guiding-bolt']!,
      classId: wizardClassId,
      isPrepared: true,
      alwaysPrepared: true,
      source: 'feat',
    });
    expect(row.is_prepared).toBe(true);
    expect(row.always_prepared).toBe(true);
    await unlearnCharacterSpell(pool, dmUserId, wizardCharacterId, row.spell_id, wizardClassId);
  });

  it('a level-1 Wizard with INT 8 (mod -1) has a floor-1 cap, not zero or negative', async () => {
    const first = await learnCharacterSpell(pool, dmUserId, lowIntWizardCharacterId, {
      spellId: level1SpellIds['bless']!,
      classId: wizardClassId,
      isPrepared: true,
      alwaysPrepared: false,
      source: 'class',
    });
    expect(first.is_prepared).toBe(true);

    await expect(
      learnCharacterSpell(pool, dmUserId, lowIntWizardCharacterId, {
        spellId: level1SpellIds['charm-person']!,
        classId: wizardClassId,
        isPrepared: true,
        alwaysPrepared: false,
        source: 'class',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('a spell recorded against a non-caster class (no spellcasting_ability_id) is never capped', async () => {
    const rows = await Promise.all(
      ['bless', 'charm-person', 'command', 'compelled-duel', 'cure-wounds'].map((slug) =>
        learnCharacterSpell(pool, dmUserId, fighterCharacterId, {
          spellId: level1SpellIds[slug]!,
          classId: fighterClassId,
          isPrepared: true,
          alwaysPrepared: false,
          source: 'feat',
        }),
      ),
    );
    expect(rows.every((r) => r.is_prepared)).toBe(true);
  });
});

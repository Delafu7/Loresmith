// docs/roadmap/dnd-2024-gap-analysis.md P1-6 (EQ-02) — behavioral coverage
// for the "known masteries" allowance/choice flow and the attack-resolution
// trigger (Sap/Vex/Slow writing real active_effects; Cleave/Graze/Nick/
// Push/Topple narrating only). Throwaway fixture style, live DB — same
// isolation convention as characterAttacks.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { AppError } from '../middleware/errors.js';
import { listCharacterWeaponMasteries, resolveWeaponMasteryTrigger, setCharacterWeaponMasteries } from './weaponMastery.js';

describe('weapon mastery (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let fighterCharacterId: string; // Fighter 1 -> allowedCount 3
  let unclassedCharacterId: string; // no character_classes rows -> allowedCount 0
  let daggerId: string; // mastery: nick
  let shortswordId: string; // mastery: vex
  let longswordId: string; // mastery: sap
  let mundaneArmorId: string; // not a weapon at all

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'WeaponMastery Test DM', 'x') RETURNING id`,
      [`weapon-mastery-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('WeaponMastery Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);

    const mkCharacter = async (name: string) => {
      const res = await pool.query<{ id: string }>(
        `INSERT INTO characters
           (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
         VALUES ($1, true, $2, $2, $3, 10, 10, 10, 10, 10, 10, 12, 30, 20, 20)
         RETURNING id`,
        [campaignId, dmUserId, name],
      );
      return res.rows[0]!.id;
    };
    fighterCharacterId = await mkCharacter('WeaponMastery Test Fighter');
    unclassedCharacterId = await mkCharacter('WeaponMastery Test Unclassed');

    const fighterClass = await pool.query<{ id: string }>(`SELECT id FROM classes WHERE index_key = 'fighter' AND edition_scope = '2024'`);
    await pool.query(`INSERT INTO character_classes (character_id, class_id, level) VALUES ($1, $2, 1)`, [fighterCharacterId, fighterClass.rows[0]!.id]);

    const items = await pool.query<{ slug: string; id: string }>(`SELECT slug, id FROM items WHERE slug IN ('dagger', 'shortsword', 'longsword', 'leather-armor')`);
    const bySlug = new Map(items.rows.map((r) => [r.slug, r.id]));
    daggerId = bySlug.get('dagger')!;
    shortswordId = bySlug.get('shortsword')!;
    longswordId = bySlug.get('longsword')!;
    mundaneArmorId = bySlug.get('leather-armor')!;
  });

  afterAll(async () => {
    // active_effects.source_character_id has no ON DELETE CASCADE (unlike
    // character_id/monster_instance_id) — this test's Sap/Vex triggers
    // leave rows sourced from fighterCharacterId that must be cleared
    // before the campaign cascade can delete that character.
    if (fighterCharacterId) await pool.query(`DELETE FROM active_effects WHERE source_character_id = $1`, [fighterCharacterId]);
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  describe('known-masteries allowance and choice', () => {
    it('an unclassed character has allowedCount 0 and no chosen masteries', async () => {
      const result = await listCharacterWeaponMasteries(pool, dmUserId, unclassedCharacterId);
      expect(result.allowedCount).toBe(0);
      expect(result.chosen).toEqual([]);
    });

    it('a level-1 2024 Fighter has allowedCount 3', async () => {
      const result = await listCharacterWeaponMasteries(pool, dmUserId, fighterCharacterId);
      expect(result.allowedCount).toBe(3);
    });

    it('rejects a non-weapon item', async () => {
      await expect(
        setCharacterWeaponMasteries(pool, dmUserId, fighterCharacterId, { itemIds: [mundaneArmorId] }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('rejects choosing more weapons than the class allowance', async () => {
      // Fighter@1 allows 3; unclassed allows 0.
      await expect(
        setCharacterWeaponMasteries(pool, dmUserId, unclassedCharacterId, { itemIds: [daggerId] }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('accepts a valid choice set within the allowance, and replaces (not merges) on a second call', async () => {
      const first = await setCharacterWeaponMasteries(pool, dmUserId, fighterCharacterId, { itemIds: [daggerId, shortswordId] });
      expect(first.chosen.map((r) => r.item_id).sort()).toEqual([daggerId, shortswordId].sort());

      const second = await setCharacterWeaponMasteries(pool, dmUserId, fighterCharacterId, { itemIds: [longswordId] });
      expect(second.chosen.map((r) => r.item_id)).toEqual([longswordId]);
    });
  });

  describe('resolveWeaponMasteryTrigger', () => {
    beforeAll(async () => {
      // Fighter knows longsword (Sap) only, from the test above's final state.
      await setCharacterWeaponMasteries(pool, dmUserId, fighterCharacterId, { itemIds: [longswordId] });
    });

    it('rejects triggering a mastery the character has not chosen', async () => {
      await expect(
        resolveWeaponMasteryTrigger(pool, dmUserId, fighterCharacterId, {
          weaponItemId: daggerId, // Nick — not in the chosen set
          outcome: 'hit',
          targetCharacterId: unclassedCharacterId,
        }),
      ).rejects.toBeInstanceOf(AppError);
    });

    it('Sap applies to the TARGET on a hit and requires no damage', async () => {
      const result = await resolveWeaponMasteryTrigger(pool, dmUserId, fighterCharacterId, {
        weaponItemId: longswordId,
        outcome: 'hit',
        targetCharacterId: unclassedCharacterId,
      });
      expect(result.masteryIndexKey).toBe('sap');
      expect(result.applied).toBe(true);
      expect(result.effect!.effect.character_id).toBe(unclassedCharacterId);
      expect(result.effect!.effectDefinitionName).toBe('Sap (Weapon Mastery)');
    });

    it('Sap does not apply on a miss', async () => {
      const result = await resolveWeaponMasteryTrigger(pool, dmUserId, fighterCharacterId, {
        weaponItemId: longswordId,
        outcome: 'miss',
        targetCharacterId: unclassedCharacterId,
      });
      expect(result.applied).toBe(false);
    });

    it('Vex applies to the ATTACKER, and only when damage was dealt', async () => {
      await setCharacterWeaponMasteries(pool, dmUserId, fighterCharacterId, { itemIds: [shortswordId] });

      const noDamage = await resolveWeaponMasteryTrigger(pool, dmUserId, fighterCharacterId, {
        weaponItemId: shortswordId,
        outcome: 'hit',
        targetCharacterId: unclassedCharacterId,
        damageDealt: 0,
      });
      expect(noDamage.applied).toBe(false);

      const withDamage = await resolveWeaponMasteryTrigger(pool, dmUserId, fighterCharacterId, {
        weaponItemId: shortswordId,
        outcome: 'hit',
        targetCharacterId: unclassedCharacterId,
        damageDealt: 5,
      });
      expect(withDamage.applied).toBe(true);
      expect(withDamage.effect!.effect.character_id).toBe(fighterCharacterId); // lands on the wielder, not the target
      expect(withDamage.effect!.effectDefinitionName).toBe('Vex (Weapon Mastery)');
    });

    it('narrative-only properties (Topple/Cleave/Push/Nick/Graze) never write an effect', async () => {
      await setCharacterWeaponMasteries(pool, dmUserId, fighterCharacterId, { itemIds: [daggerId] }); // Nick

      const nick = await resolveWeaponMasteryTrigger(pool, dmUserId, fighterCharacterId, {
        weaponItemId: daggerId,
        outcome: 'hit',
        targetCharacterId: unclassedCharacterId,
      });
      expect(nick.masteryIndexKey).toBe('nick');
      expect(nick.applied).toBe(false);
      expect(nick.effect).toBeUndefined();
      expect(nick.message.length).toBeGreaterThan(0);
    });
  });
});

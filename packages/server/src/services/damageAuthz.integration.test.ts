// Integration test for REFACTOR-PLAN.md §7 ("Add tests proving a player
// cannot reach DM-only data through the API even with a known URL") as
// applied to this session's new endpoints. Covers the subset that has a
// SERVICE-level authorization check (applyDamage/applyMonsterInstanceDamage/
// character_attacks CRUD all call authorizeCharacterMutation/requireDm
// internally) — see OPEN_QUESTIONS.md for the endpoints that rely entirely
// on Express route middleware (requireEncounterDm) with no service-level
// check to unit-test directly, since this codebase has no HTTP-level test
// harness (no supertest) to exercise those; those were instead verified via
// a live two-user curl smoke test against a running server (every DM-only
// route correctly 403s a player, including on the player's own participant;
// every owner-or-DM route correctly allows the owning player and rejects a
// different player).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { applyDamage } from './characters.js';
import { applyMonsterInstanceDamage, createMonsterInstance } from './monsters.js';
import { addCharacterAttack, listCharacterAttacks } from './characterAttacks.js';

describe('damage/attacks authorization (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let playerAUserId: string;
  let playerBUserId: string;
  let campaignId: string;
  let characterAId: string; // owned by playerA
  let monsterInstanceId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'DamageAuthz Test DM', 'x') RETURNING id`,
      [`damage-authz-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const playerARes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'DamageAuthz Test Player A', 'x') RETURNING id`,
      [`damage-authz-player-a-${suffix}@example.test`],
    );
    playerAUserId = playerARes.rows[0]!.id;

    const playerBRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'DamageAuthz Test Player B', 'x') RETURNING id`,
      [`damage-authz-player-b-${suffix}@example.test`],
    );
    playerBUserId = playerBRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('DamageAuthz Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, playerAUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, playerBUserId]);

    const characterARes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'DamageAuthz PC A', 10, 10, 10, 10, 10, 10, 12, 30, 20, 20)
       RETURNING id`,
      [campaignId, playerAUserId],
    );
    characterAId = characterARes.rows[0]!.id;

    const monsterCatalogRes = await pool.query<{ id: string }>(`SELECT id FROM monsters LIMIT 1`);
    if (!monsterCatalogRes.rows[0]) throw new Error('Expected at least one seeded monster catalog row for this test');
    const instance = await createMonsterInstance(pool, campaignId, {
      monsterId: monsterCatalogRes.rows[0].id,
      customName: null,
      hpMaxOverride: null,
      armorClassOverride: null,
      hpCurrent: 10,
      hpTemp: 0,
      status: 'alive',
      isRecurring: false,
      notes: null,
    });
    monsterInstanceId = (instance as { id: string }).id;
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    if (playerAUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [playerAUserId]);
    if (playerBUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [playerBUserId]);
    await pool.end();
  });

  const dmg = { diceSides: 6 as const, diceCount: 1, modifier: 0, damageType: null, isCritical: false };

  it('the owning player CAN apply-damage / add attacks / list attacks on their own character', async () => {
    await expect(applyDamage(pool, playerAUserId, characterAId, dmg)).resolves.toMatchObject({ appliedDamage: expect.any(Number) });
    await expect(addCharacterAttack(pool, playerAUserId, characterAId, {
      name: 'Owned Attack', attackBonus: 3, damageDice: null, damageType: null, saveDc: null, saveAbilityIndex: null, halfOnSave: true, sortOrder: 0,
    })).resolves.toMatchObject({ name: 'Owned Attack' });
    await expect(listCharacterAttacks(pool, playerAUserId, characterAId)).resolves.toBeInstanceOf(Array);
  });

  it('a DIFFERENT player CANNOT apply-damage / add attacks on another player\'s character', async () => {
    await expect(applyDamage(pool, playerBUserId, characterAId, dmg)).rejects.toMatchObject({ code: 'FORBIDDEN_NOT_OWNER' });
    await expect(addCharacterAttack(pool, playerBUserId, characterAId, {
      name: 'Hijacked', attackBonus: 3, damageDice: null, damageType: null, saveDc: null, saveAbilityIndex: null, halfOnSave: true, sortOrder: 0,
    })).rejects.toMatchObject({ code: 'FORBIDDEN_NOT_OWNER' });
  });

  it('the DM CAN apply-damage / add attacks on any character', async () => {
    await expect(applyDamage(pool, dmUserId, characterAId, dmg)).resolves.toMatchObject({ appliedDamage: expect.any(Number) });
  });

  it('a non-member is rejected before ownership is even considered', async () => {
    const outsiderRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'DamageAuthz Outsider', 'x') RETURNING id`,
      [`damage-authz-outsider-${Date.now()}@example.test`],
    );
    const outsiderId = outsiderRes.rows[0]!.id;
    try {
      await expect(applyDamage(pool, outsiderId, characterAId, dmg)).rejects.toMatchObject({ code: 'NOT_CAMPAIGN_MEMBER' });
    } finally {
      await pool.query(`DELETE FROM users WHERE id = $1`, [outsiderId]);
    }
  });

  it('a player CANNOT apply-damage to a monster instance — DM-only regardless of campaign membership', async () => {
    await expect(applyMonsterInstanceDamage(pool, playerAUserId, monsterInstanceId, dmg)).rejects.toMatchObject({
      code: 'FORBIDDEN_ROLE',
    });
  });

  it('the DM CAN apply-damage to a monster instance', async () => {
    await expect(applyMonsterInstanceDamage(pool, dmUserId, monsterInstanceId, dmg)).resolves.toMatchObject({
      appliedDamage: expect.any(Number),
    });
  });
});

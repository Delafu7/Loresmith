// Regression test for Iteration 3 blocker B1 — redactGmNotes was only ever
// called from getCharacter/listCharacters; every mutation that returns a
// character row as part of its response (updateCharacter, applyHpDelta,
// applyDamage, updateArmorClassMode, duplicateCharacter) returned the raw
// row with gm_notes included, so a player doing an ordinary HP adjust on
// their own owned character got the DM's private note back verbatim.
// Live-confirmed this session via a direct authenticated API call before
// the fix. Throwaway campaign/character fixtures, same isolation
// convention as characters.duplicate.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import {
  applyDamage,
  applyHpDelta,
  duplicateCharacter,
  updateArmorClassMode,
  updateCharacter,
} from './characters.js';

const SECRET = 'The apparent ally is secretly the lich in disguise.';

describe('gm_notes redaction on mutation responses (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let playerUserId: string;
  let campaignId: string;
  let pcId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'GM Notes Test DM', 'x') RETURNING id`,
      [`gm-notes-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const playerRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'GM Notes Test Player', 'x') RETURNING id`,
      [`gm-notes-player-${suffix}@example.test`],
    );
    playerUserId = playerRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('GM Notes Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, playerUserId]);

    const pcRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha,
          armor_class, speed, hp_max, hp_current, gm_notes,
          damage_resistances, damage_vulnerabilities, damage_immunities)
       VALUES ($1, true, $2, $2, 'Notes Test PC', 10, 10, 10, 10, 10, 10, 12, 30, 20, 20, $3, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[])
       RETURNING id`,
      [campaignId, playerUserId, SECRET],
    );
    pcId = pcRes.rows[0]!.id;
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    for (const id of [dmUserId, playerUserId]) {
      if (id) await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
    }
    await pool.end();
  });

  it('applyHpDelta strips gm_notes for the owning player', async () => {
    const result = await applyHpDelta(pool, playerUserId, pcId, { delta: -1, tempDelta: 0 });
    expect(result.character.gm_notes).toBeUndefined();
  });

  it('applyDamage strips gm_notes for the owning player', async () => {
    const result = await applyDamage(pool, playerUserId, pcId, {
      diceCount: 1,
      diceSides: 4,
      modifier: 0,
      isCritical: false,
      damageType: null,
    } as Parameters<typeof applyDamage>[3]);
    expect(result.character.gm_notes).toBeUndefined();
  });

  it('updateCharacter strips gm_notes for the owning player', async () => {
    const result = await updateCharacter(pool, playerUserId, pcId, { speed: 35 } as Parameters<typeof updateCharacter>[3]);
    expect((result.character as Record<string, unknown>).gm_notes).toBeUndefined();
  });

  it('updateArmorClassMode strips gm_notes for the owning player (manual branch)', async () => {
    const result = await updateArmorClassMode(pool, playerUserId, pcId, { mode: 'manual' } as Parameters<typeof updateArmorClassMode>[3]);
    expect((result.character as Record<string, unknown>).gm_notes).toBeUndefined();
  });

  it('duplicateCharacter strips gm_notes for the owning player and never copies it onto the new row', async () => {
    const copy = await duplicateCharacter(pool, playerUserId, pcId);
    expect((copy as Record<string, unknown>).gm_notes).toBeUndefined();

    const raw = await pool.query<{ gm_notes: string | null }>(`SELECT gm_notes FROM characters WHERE id = $1`, [copy.id]);
    expect(raw.rows[0]!.gm_notes).toBeNull();

    await pool.query(`DELETE FROM characters WHERE id = $1`, [copy.id]);
  });

  it('the DM still receives gm_notes on the same mutations', async () => {
    const result = await applyHpDelta(pool, dmUserId, pcId, { delta: 0, tempDelta: 0 });
    expect((result.character as Record<string, unknown>).gm_notes).toBe(SECRET);
  });

  // Phase 3 "NPC 'what they want' field" — npc_motivation reuses gm_notes'
  // exact redaction rule (see redactGmNotes's own comment); this locks in
  // both halves of that: a DM can write it, a non-DM write is silently
  // dropped (not an error), and a non-DM read never sees it regardless of
  // who wrote it.
  describe('npc_motivation (Phase 3)', () => {
    const MOTIVATION = 'Secretly wants the crown for themselves.';

    it('a DM can set npc_motivation via updateCharacter, and it is redacted for the owning player on read', async () => {
      const asDm = await updateCharacter(pool, dmUserId, pcId, { npcMotivation: MOTIVATION } as Parameters<typeof updateCharacter>[3]);
      expect((asDm.character as Record<string, unknown>).npc_motivation).toBe(MOTIVATION);

      const asPlayer = await applyHpDelta(pool, playerUserId, pcId, { delta: 0, tempDelta: 0 });
      expect((asPlayer.character as Record<string, unknown>).npc_motivation).toBeUndefined();
    });

    it('a non-DM write to npc_motivation is silently dropped, not an error, and does not change the stored value', async () => {
      await updateCharacter(pool, playerUserId, pcId, { npcMotivation: 'Player tries to plant a fake motivation.' } as Parameters<
        typeof updateCharacter
      >[3]);
      const raw = await pool.query<{ npc_motivation: string | null }>(`SELECT npc_motivation FROM characters WHERE id = $1`, [pcId]);
      expect(raw.rows[0]!.npc_motivation).toBe(MOTIVATION);
    });
  });
});

// Integration test for the reveal engine's end-to-end read path (PLAN.md
// §11.8): a player-role GET must never contain an unrevealed field's true
// value, even before any WebSocket involvement — this exercises the real
// wiring in services/characters.ts (getCharacter/listCharacters), not just
// the pure redactEntityFields unit (entityFieldReveal.test.ts). Throwaway
// campaign/user/character fixtures, same isolation convention as
// rests.performRest.integration.test.ts — never touches the seeded demo
// campaign.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { getCharacter, listCharacters } from './characters.js';
import { updateCharacterReveals } from './entityFieldReveal.js';

describe('reveal engine read-path redaction (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: number;
  let playerUserId: number;
  let campaignId: number;
  let npcId: number;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: number }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Reveal Test DM', 'x') RETURNING id`,
      [`reveal-test-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const playerRes = await pool.query<{ id: number }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Reveal Test Player', 'x') RETURNING id`,
      [`reveal-test-player-${suffix}@example.test`],
    );
    playerUserId = playerRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: number }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Reveal Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;

    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, playerUserId]);

    const npcRes = await pool.query<{ id: number }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha,
          armor_class, hp_max, hp_current, notes)
       VALUES ($1, false, NULL, $2, 'Reveal Test NPC', 10, 10, 10, 10, 10, 10, 15, 10, 10, 'Secretly a doppelganger')
       RETURNING id`,
      [campaignId, dmUserId],
    );
    npcId = npcRes.rows[0]!.id;
  });

  afterAll(async () => {
    try {
      if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    } finally {
      if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
      if (playerUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [playerUserId]);
      await pool.end();
    }
  });

  it('a fresh NPC defaults to hidden armor_class/notes for a player, but true values for the DM', async () => {
    const dmView = (await getCharacter(pool, dmUserId, npcId)) as unknown as { armor_class: number; notes: string };
    expect(dmView.armor_class).toBe(15);
    expect(dmView.notes).toBe('Secretly a doppelganger');

    const playerView = (await getCharacter(pool, playerUserId, npcId)) as unknown as { armor_class: number | null; notes: string | null };
    expect(playerView.armor_class).toBeNull();
    expect(playerView.notes).toBeNull();

    // Same redaction must hold on the list endpoint, not just GET by id.
    const playerList = (await listCharacters(pool, campaignId, 'player')) as unknown as Array<{ id: number; armor_class: number | null }>;
    const npcRow = playerList.find((c) => c.id === npcId);
    expect(npcRow?.armor_class).toBeNull();
  });

  it('revealing a field as DM makes the true value visible to a player, without touching other fields', async () => {
    await updateCharacterReveals(pool, dmUserId, npcId, { fields: [{ fieldKey: 'armor_class', revealed: true }] });

    const playerView = (await getCharacter(pool, playerUserId, npcId)) as unknown as { armor_class: number | null; notes: string | null };
    expect(playerView.armor_class).toBe(15);
    expect(playerView.notes).toBeNull(); // still hidden — revealing one field must not leak others
  });

  it('a playerOverride is served to the player instead of the true value, while the DM still sees the truth', async () => {
    await updateCharacterReveals(pool, dmUserId, npcId, {
      fields: [{ fieldKey: 'notes', revealed: true, playerOverride: 'Something about it feels wrong.' }],
    });

    const playerView = (await getCharacter(pool, playerUserId, npcId)) as unknown as { notes: string | null };
    expect(playerView.notes).toBe('Something about it feels wrong.');

    const dmView = (await getCharacter(pool, dmUserId, npcId)) as unknown as { notes: string | null };
    expect(dmView.notes).toBe('Secretly a doppelganger');
  });

  it('a player cannot write reveal state (DM-only), even for a campaign they are a member of', async () => {
    await expect(
      updateCharacterReveals(pool, playerUserId, npcId, { fields: [{ fieldKey: 'armor_class', revealed: true }] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
  });
});

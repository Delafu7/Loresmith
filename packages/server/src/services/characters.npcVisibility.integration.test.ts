// DM hide/reveal for NPCs — same reusable role_split layer as
// locations/factions (services/visibility.ts, see services/locations.ts's
// header comment), applied here via services/characters.ts's
// requireCharacterVisible/requireCharacterReadAccess. Covers: a new NPC is
// hidden by default; a hidden NPC is absent from a player's listCharacters
// and 404s on a direct getCharacter; a sibling sub-resource read (items) 404s
// the same way, proving the check lives in one reusable place rather than
// being re-derived per endpoint; a PC is never affected by any of this; and
// a non-DM's attempt to set the field on their own PC is silently dropped,
// same precedent as gm_notes/npc_motivation (see
// characters.gmNotesRedaction.integration.test.ts). Same throwaway
// campaign/user fixture convention as that file.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { AppError } from '../middleware/errors.js';
import { createCharacter, getCharacter, listCharacters, updateCharacter } from './characters.js';
import { listCharacterItems } from './characterItems.js';

describe('NPC visibility (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let playerUserId: string;
  let campaignId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'NPC Visibility Test DM', 'x') RETURNING id`,
      [`npc-visibility-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const playerRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'NPC Visibility Test Player', 'x') RETURNING id`,
      [`npc-visibility-player-${suffix}@example.test`],
    );
    playerUserId = playerRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('NPC Visibility Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'player')`, [campaignId, playerUserId]);
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    for (const id of [dmUserId, playerUserId]) {
      if (id) await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
    }
    await pool.end();
  });

  const npcInput = {
    name: 'The Hooded Stranger',
    isPc: false,
    str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
    armorClass: 12, speed: 30, hpMax: 10, hpTemp: 0, exhaustionLevel: 0,
    damageResistances: [], damageVulnerabilities: [], damageImmunities: [],
  } as Parameters<typeof createCharacter>[4];

  it('creates an NPC hidden by default, hides it from a player list/get/sub-resource, then reveals it', async () => {
    const npc = await createCharacter(pool, dmUserId, campaignId, 'dm', npcInput);
    expect(npc.visible_to_players).toBe(false);

    const listedForDm = await listCharacters(pool, campaignId, dmUserId, 'dm');
    expect(listedForDm.map((c) => c.id)).toContain(npc.id);

    const listedForPlayerHidden = await listCharacters(pool, campaignId, playerUserId, 'player');
    expect(listedForPlayerHidden.map((c) => c.id)).not.toContain(npc.id);

    await expect(getCharacter(pool, playerUserId, npc.id)).rejects.toBeInstanceOf(AppError);
    // Same reusable check via a sibling service (services/characterItems.ts)
    // — proves the gate isn't re-derived per endpoint.
    await expect(listCharacterItems(pool, playerUserId, npc.id)).rejects.toBeInstanceOf(AppError);

    // DM reads are unaffected throughout.
    await expect(getCharacter(pool, dmUserId, npc.id)).resolves.toBeTruthy();

    const revealed = await updateCharacter(pool, dmUserId, npc.id, { visibleToPlayers: true } as Parameters<typeof updateCharacter>[3]);
    expect((revealed.character as Record<string, unknown>).visible_to_players).toBe(true);

    const listedForPlayerRevealed = await listCharacters(pool, campaignId, playerUserId, 'player');
    expect(listedForPlayerRevealed.map((c) => c.id)).toContain(npc.id);

    const gotByPlayer = await getCharacter(pool, playerUserId, npc.id);
    expect(gotByPlayer.id).toBe(npc.id);
    await expect(listCharacterItems(pool, playerUserId, npc.id)).resolves.toEqual([]);

    await pool.query(`DELETE FROM characters WHERE id = $1`, [npc.id]);
  });

  it('a PC is always visible to a player, regardless of visible_to_players', async () => {
    const pc = await createCharacter(pool, playerUserId, campaignId, 'player', {
      name: 'Player PC', isPc: true,
      str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10,
      armorClass: 12, speed: 30, hpMax: 10, hpTemp: 0, exhaustionLevel: 0,
      damageResistances: [], damageVulnerabilities: [], damageImmunities: [],
    } as Parameters<typeof createCharacter>[4]);

    const listedForPlayer = await listCharacters(pool, campaignId, playerUserId, 'player');
    expect(listedForPlayer.map((c) => c.id)).toContain(pc.id);
    await expect(getCharacter(pool, playerUserId, pc.id)).resolves.toBeTruthy();

    // Same precedent as gm_notes/npc_motivation (characters.
    // gmNotesRedaction.integration.test.ts): a non-DM patch of a DM-only
    // field is silently dropped, not an error, and the stored value is
    // unaffected (it stays false — a PC's value is meaningless anyway since
    // requireCharacterVisible always treats is_pc = true as visible).
    await updateCharacter(pool, playerUserId, pc.id, { visibleToPlayers: true } as Parameters<typeof updateCharacter>[3]);
    const raw = await pool.query<{ visible_to_players: boolean }>(`SELECT visible_to_players FROM characters WHERE id = $1`, [pc.id]);
    expect(raw.rows[0]!.visible_to_players).toBe(false);

    await pool.query(`DELETE FROM characters WHERE id = $1`, [pc.id]);
  });
});

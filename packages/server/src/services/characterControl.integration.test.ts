// Integration tests for Iteration 2 "Character ownership vs. control" —
// delegateControl/revokeControl round-trip, event history, and the
// downstream effect on authorizeCharacterAction (services/characters.ts):
// a delegated controller can act for a character they don't own; a former
// controller who's been revoked (or was simply never controller) cannot.
// Throwaway campaign/user/character fixtures, same isolation convention as
// spawn.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { AppError } from '../middleware/errors.js';
import { delegateControl, listControlDelegations, revokeControl } from './characterControl.js';
import { applyHpDelta } from './characters.js';

describe('character control delegation (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let ownerUserId: string;
  let otherPlayerUserId: string;
  let spectatorUserId: string;
  let outsiderUserId: string;
  let campaignId: string;
  let characterId: string;
  let npcCharacterId: string;

  async function makeUser(label: string, suffix: string): Promise<string> {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, 'x') RETURNING id`,
      [`control-${label}-${suffix}@example.test`, `Control Test ${label}`],
    );
    return res.rows[0]!.id;
  }

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    dmUserId = await makeUser('dm', suffix);
    ownerUserId = await makeUser('owner', suffix);
    otherPlayerUserId = await makeUser('other', suffix);
    spectatorUserId = await makeUser('spectator', suffix);
    outsiderUserId = await makeUser('outsider', suffix);

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Control Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;

    await pool.query(
      `INSERT INTO campaign_members (campaign_id, user_id, role) VALUES
         ($1, $2, 'dm'), ($1, $3, 'player'), ($1, $4, 'player'), ($1, $5, 'spectator')`,
      [campaignId, dmUserId, ownerUserId, otherPlayerUserId, spectatorUserId],
    );

    async function makeCharacter(name: string, isPc: boolean, owner: string | null): Promise<string> {
      const res = await pool.query<{ id: string }>(
        `INSERT INTO characters
           (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha,
            armor_class, speed, hp_max, hp_current)
         VALUES ($1, $2, $3, $4, $5, 10, 10, 10, 10, 10, 10, 12, 30, 20, 20)
         RETURNING id`,
        [campaignId, isPc, owner, dmUserId, name],
      );
      return res.rows[0]!.id;
    }

    characterId = await makeCharacter('Control Test PC', true, ownerUserId);
    npcCharacterId = await makeCharacter('Control Test NPC', false, null);
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [
      [dmUserId, ownerUserId, otherPlayerUserId, spectatorUserId, outsiderUserId],
    ]);
    await pool.end();
  });

  it('rejects a non-DM attempting to delegate control', async () => {
    await expect(
      delegateControl(pool, characterId, ownerUserId, { toUserId: otherPlayerUserId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
  });

  it('rejects delegating an NPC (the DM already controls every NPC by default)', async () => {
    await expect(
      delegateControl(pool, npcCharacterId, dmUserId, { toUserId: otherPlayerUserId }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects delegating to a non-member', async () => {
    await expect(
      delegateControl(pool, characterId, dmUserId, { toUserId: outsiderUserId }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects delegating to a spectator', async () => {
    await expect(
      delegateControl(pool, characterId, dmUserId, { toUserId: spectatorUserId }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects delegating to the character\'s current effective controller (no-op)', async () => {
    // No delegation yet — the effective controller is the owner.
    await expect(
      delegateControl(pool, characterId, dmUserId, { toUserId: ownerUserId }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('a former controller loses action rights once control is revoked, and the owner regains them', async () => {
    // Before any delegation, the owner can act...
    await expect(applyHpDelta(pool, ownerUserId, characterId, { delta: -1, tempDelta: 0 })).resolves.toBeDefined();
    // ...and a non-owner, non-controller player cannot.
    await expect(applyHpDelta(pool, otherPlayerUserId, characterId, { delta: -1, tempDelta: 0 })).rejects.toMatchObject({
      code: 'FORBIDDEN_NOT_OWNER',
    });

    const { character, event } = await delegateControl(pool, characterId, dmUserId, {
      toUserId: otherPlayerUserId,
      reason: 'Owner is away this session',
    });
    expect(character.controller_user_id).toBe(otherPlayerUserId);
    expect(event.from_controller_user_id).toBe(ownerUserId); // fell back to owner, since no prior delegation existed
    expect(event.to_controller_user_id).toBe(otherPlayerUserId);
    expect(event.granted_by_user_id).toBe(dmUserId);
    expect(event.reason).toBe('Owner is away this session');

    // Now the delegated controller can act...
    await expect(applyHpDelta(pool, otherPlayerUserId, characterId, { delta: -1, tempDelta: 0 })).resolves.toBeDefined();
    // ...and the OWNER (no longer the effective controller) cannot.
    await expect(applyHpDelta(pool, ownerUserId, characterId, { delta: -1, tempDelta: 0 })).rejects.toMatchObject({
      code: 'FORBIDDEN_NOT_OWNER',
    });
    // The DM can always act, regardless of delegation.
    await expect(applyHpDelta(pool, dmUserId, characterId, { delta: -1, tempDelta: 0 })).resolves.toBeDefined();

    const { character: revoked, event: revokeEvent } = await revokeControl(pool, characterId, dmUserId);
    expect(revoked.controller_user_id).toBeNull();
    expect(revokeEvent.from_controller_user_id).toBe(otherPlayerUserId);
    expect(revokeEvent.to_controller_user_id).toBeNull();

    // Control reverts to the owner now that the delegation is revoked.
    await expect(applyHpDelta(pool, ownerUserId, characterId, { delta: -1, tempDelta: 0 })).resolves.toBeDefined();
    await expect(applyHpDelta(pool, otherPlayerUserId, characterId, { delta: -1, tempDelta: 0 })).rejects.toMatchObject({
      code: 'FORBIDDEN_NOT_OWNER',
    });
  });

  it('rejects revoking when there is no active delegation', async () => {
    await expect(revokeControl(pool, characterId, dmUserId)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('lists delegation history newest-first, readable by any campaign member', async () => {
    await delegateControl(pool, characterId, dmUserId, { toUserId: otherPlayerUserId, reason: 'Second delegation' });

    const events = await listControlDelegations(pool, ownerUserId, characterId);
    expect(events.length).toBeGreaterThanOrEqual(3); // delegate, revoke, delegate again from the tests above
    expect(events[0]!.reason).toBe('Second delegation');
    expect(new Date(events[0]!.created_at).getTime()).toBeGreaterThanOrEqual(new Date(events[1]!.created_at).getTime());

    // Clean up the dangling delegation left by this test so later runs of
    // the no-op/NPC tests above (if re-ordered) aren't affected by a stray
    // active delegation — not strictly necessary given vitest's declaration
    // order, but cheap and avoids a hidden inter-test dependency.
    await revokeControl(pool, characterId, dmUserId);
  });

  it('throws NOT_FOUND for a nonexistent character', async () => {
    await expect(
      delegateControl(pool, '00000000-0000-0000-0000-000000000000', dmUserId, { toUserId: otherPlayerUserId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(listControlDelegations(pool, dmUserId, '00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(AppError);
  });
});

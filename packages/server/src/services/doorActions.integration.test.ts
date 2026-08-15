// Integration test for performDoorAction (services/doorActions.ts) — mirrors
// grapple.integration.test.ts's fixture shape. The encounter is left in its
// default (non-'active') status so requireCurrentTurn (via
// applyActionEconomy) is a no-op, letting every participant act regardless
// of turn order — same simplification shove/grapple's own non-turnOrder
// tests rely on (see shove.test.ts vs. shove.turnOrderAuthz.integration.test.ts
// for the split). Force-check determinism is achieved via each door's own
// props.forceDC (DC 1 = guaranteed success, DC 999 = guaranteed failure)
// rather than mocking the RNG — the same "control it through real input,
// not a mock" approach grapple's defenderRollOverride uses.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { addParticipant, createEncounter } from './encounters.js';
import { createMap, linkMapToEncounter, setActiveMap } from './maps.js';
import { createMapElement } from './mapElements.js';
import { performDoorAction } from './doorActions.js';

describe('performDoorAction (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let encounterId: string;

  async function makeParticipant(str: number): Promise<string> {
    const charRes = await pool.query<{ id: string }>(
      `INSERT INTO characters
         (campaign_id, is_pc, owner_user_id, created_by_user_id, name, str, dex, con, int, wis, cha, armor_class, speed, hp_max, hp_current)
       VALUES ($1, true, $2, $2, 'Door Test PC', $3, 10, 10, 10, 10, 10, 12, 30, 10, 10)
       RETURNING id`,
      [campaignId, dmUserId, str],
    );
    const { participant } = await addParticipant(pool, encounterId, { characterId: charRes.rows[0]!.id });
    return participant.id;
  }

  async function makeDoor(state: string, forceDC?: number): Promise<string> {
    const { element } = await createMapElement(pool, encounterId, {
      type: 'door',
      x1: 0, y1: 0, x2: 0, y2: 1,
      props: forceDC == null ? { state } : { state, forceDC },
    });
    return element.id;
  }

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Door Test DM', 'x') RETURNING id`,
      [`door-test-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Door Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;

    const map = await createMap(pool, campaignId, { name: 'Door Test Map' });
    const encounter = await createEncounter(pool, campaignId, { name: 'Door Test Encounter' });
    encounterId = encounter.id;
    await linkMapToEncounter(pool, encounterId, map.id);
    await setActiveMap(pool, encounterId, map.id);
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  it('opening a closed door spends the object interaction, not the action', async () => {
    const participantId = await makeParticipant(10);
    const doorId = await makeDoor('closed');

    const result = await performDoorAction(pool, encounterId, participantId, dmUserId, 'dm', doorId, 'open');
    expect(result.element.props).toMatchObject({ state: 'open' });
    expect(result.roll).toBeNull();
    expect(result.success).toBeNull();
    expect(result.economy.participant.object_interaction_used).toBe(true);
    expect(result.economy.participant.action_used).toBe(false);
  });

  it('closing an open door succeeds', async () => {
    const participantId = await makeParticipant(10);
    const doorId = await makeDoor('open');

    const result = await performDoorAction(pool, encounterId, participantId, dmUserId, 'dm', doorId, 'close');
    expect(result.element.props).toMatchObject({ state: 'closed' });
  });

  it('rejects opening a door that is not closed', async () => {
    const participantId = await makeParticipant(10);
    const doorId = await makeDoor('open');

    await expect(performDoorAction(pool, encounterId, participantId, dmUserId, 'dm', doorId, 'open')).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects a second object interaction from the same participant in the same turn', async () => {
    const participantId = await makeParticipant(10);
    const doorA = await makeDoor('closed');
    const doorB = await makeDoor('closed');

    await performDoorAction(pool, encounterId, participantId, dmUserId, 'dm', doorA, 'open');
    await expect(performDoorAction(pool, encounterId, participantId, dmUserId, 'dm', doorB, 'open')).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('forcing a locked door with a trivial DC spends the action and always succeeds', async () => {
    const participantId = await makeParticipant(10);
    const doorId = await makeDoor('locked', 1);

    const result = await performDoorAction(pool, encounterId, participantId, dmUserId, 'dm', doorId, 'force');
    expect(result.success).toBe(true);
    expect(result.roll).not.toBeNull();
    expect(result.element.props).toMatchObject({ state: 'open' });
    expect(result.economy.participant.action_used).toBe(true);
    expect(result.economy.participant.object_interaction_used).toBe(false);
  });

  it('forcing a stuck door with an impossible DC always fails and leaves the state untouched', async () => {
    const participantId = await makeParticipant(10);
    const doorId = await makeDoor('stuck', 999);

    const result = await performDoorAction(pool, encounterId, participantId, dmUserId, 'dm', doorId, 'force');
    expect(result.success).toBe(false);
    expect(result.roll).not.toBeNull();
    expect(result.element.props).toMatchObject({ state: 'stuck' });
    // A failed force still spends the action — no RAW refund for a failed check.
    expect(result.economy.participant.action_used).toBe(true);
  });

  it('rejects forcing a door that is neither locked nor stuck', async () => {
    const participantId = await makeParticipant(10);
    const doorId = await makeDoor('broken');

    await expect(performDoorAction(pool, encounterId, participantId, dmUserId, 'dm', doorId, 'force')).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

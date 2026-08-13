// GM-only visibility layer (nav point 2) — the core regression test for the
// primary defect this feature fixes: GET /:id/map/elements used to return
// every row, including 'note' elements and any visible_to_players=false
// row, to every campaign member unfiltered. formatMapElementForViewer is
// the server-side enforcement point every read path (REST GET,
// buildFullStateSyncPayload, broadcastMapElementsChanged) now routes
// through. Covers: full omission for a hidden note/area/image, geometry-only
// redaction (never label/props) for a hidden wall/door/light, and
// computeBlocksVision's truth table matching the client registry's own
// wall/door blocksVision rule (services/mapElements.ts's doc comment on
// why the two must stay in sync). Throwaway campaign/encounter/map
// fixtures, same isolation convention as mapElements.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { createEncounter } from './encounters.js';
import { createMap, linkMapToEncounter, setActiveMap } from './maps.js';
import { createMapElement, formatMapElementForViewer } from './mapElements.js';
import { computeBlocksVision } from '../domain/mapElementVisibility.js';

describe('map elements visibility (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let playerUserId: string;
  let ownerUserId: string;
  let campaignId: string;
  let encounterId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'MapElements Visibility Test DM', 'x') RETURNING id`,
      [`map-elements-vis-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const playerRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'MapElements Visibility Test Player', 'x') RETURNING id`,
      [`map-elements-vis-player-${suffix}@example.test`],
    );
    playerUserId = playerRes.rows[0]!.id;

    const ownerRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'MapElements Visibility Test Owner', 'x') RETURNING id`,
      [`map-elements-vis-owner-${suffix}@example.test`],
    );
    ownerUserId = ownerRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('MapElements Visibility Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;

    const map = await createMap(pool, campaignId, { name: 'Visibility Test Map' });
    const encounter = await createEncounter(pool, campaignId, { name: 'Visibility Test Encounter' });
    encounterId = encounter.id;
    await linkMapToEncounter(pool, encounterId, map.id);
    await setActiveMap(pool, encounterId, map.id);
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    for (const id of [dmUserId, playerUserId, ownerUserId]) {
      if (id) await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
    }
    await pool.end();
  });

  it('a gm_only note is fully omitted for a player, but full for the DM', async () => {
    const { element } = await createMapElement(pool, encounterId, {
      type: 'note',
      x1: 1, y1: 1,
      props: { body: 'Secret DM annotation' },
      visibility: 'gm_only',
    });

    expect(formatMapElementForViewer(element, playerUserId, 'player')).toBeNull();

    const forDm = formatMapElementForViewer(element, dmUserId, 'dm');
    expect(forDm).not.toBeNull();
    expect((forDm as { props: unknown }).props).toEqual({ body: 'Secret DM annotation' });
  });

  it('a gm_only wall is redacted to geometry-only for a player — label/props never present', async () => {
    const { element } = await createMapElement(pool, encounterId, {
      type: 'wall',
      x1: 0, y1: 0, x2: 5, y2: 0,
      label: 'Secret Passage Wall',
      visibility: 'gm_only',
    });

    const forPlayer = formatMapElementForViewer(element, playerUserId, 'player') as Record<string, unknown>;
    expect(forPlayer).not.toBeNull();
    expect(forPlayer.redacted).toBe(true);
    expect(forPlayer.blocksVision).toBe(true);
    expect(forPlayer.x1).toBe(0);
    expect(forPlayer.x2).toBe(5);
    // The whole point of redaction, not omission — assert the sensitive
    // keys are LITERALLY ABSENT, not just falsy.
    expect('label' in forPlayer).toBe(false);
    expect('props' in forPlayer).toBe(false);
  });

  it('a gm_only door is redacted to a server-computed blocksVision boolean — never the raw state', async () => {
    const { element } = await createMapElement(pool, encounterId, {
      type: 'door',
      x1: 2, y1: 2, x2: 3, y2: 2,
      props: { state: 'locked' },
      visibility: 'gm_only',
    });

    const forPlayer = formatMapElementForViewer(element, playerUserId, 'player') as Record<string, unknown>;
    expect(forPlayer.blocksVision).toBe(true);
    expect('props' in forPlayer).toBe(false);
  });

  it('a gm_only light is redacted to its radii only — color/intensity/label never present', async () => {
    const { element } = await createMapElement(pool, encounterId, {
      type: 'light',
      x1: 4, y1: 4,
      label: 'Hidden Torch',
      props: { brightRadiusFt: 20, dimRadiusFt: 40, color: '#ff0000', intensity: 0.9 },
      visibility: 'gm_only',
    });

    const forPlayer = formatMapElementForViewer(element, playerUserId, 'player') as Record<string, unknown>;
    expect(forPlayer.lightRadii).toEqual({ brightRadiusFt: 20, dimRadiusFt: 40 });
    expect('label' in forPlayer).toBe(false);
    expect('props' in forPlayer).toBe(false);
  });

  it('a gm_only area/image is fully omitted for a player (never blocks vision, nothing to redact)', async () => {
    const { element: area } = await createMapElement(pool, encounterId, {
      type: 'area',
      points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
      props: { shape: 'polygon', costType: 'difficult', color: '#663399' },
      visibility: 'gm_only',
    });
    expect(formatMapElementForViewer(area, playerUserId, 'player')).toBeNull();

    const { element: image } = await createMapElement(pool, encounterId, {
      type: 'image',
      x1: 6, y1: 6,
      props: { assetId: null, widthFt: 5, heightFt: 5, rotationDeg: 0, opacity: 1 },
      visibility: 'gm_only',
    });
    expect(formatMapElementForViewer(image, playerUserId, 'player')).toBeNull();
  });

  it('a revealed_to_players element is sent in full to a player', async () => {
    const { element } = await createMapElement(pool, encounterId, {
      type: 'note',
      x1: 7, y1: 7,
      props: { body: 'Public sign text' },
      visibility: 'revealed_to_players',
    });
    const forPlayer = formatMapElementForViewer(element, playerUserId, 'player');
    expect(forPlayer).toMatchObject({ props: { body: 'Public sign text' } });
  });

  it('an owner_only element is full for its owner, omitted (or redacted) for everyone else', async () => {
    const { element } = await createMapElement(pool, encounterId, {
      type: 'note',
      x1: 8, y1: 8,
      props: { body: "Only Bob's rogue notices this" },
      visibility: 'owner_only',
      ownerUserId,
    });

    expect(formatMapElementForViewer(element, ownerUserId, 'player')).toMatchObject({ props: { body: "Only Bob's rogue notices this" } });
    expect(formatMapElementForViewer(element, playerUserId, 'player')).toBeNull();
    expect(formatMapElementForViewer(element, dmUserId, 'dm')).toMatchObject({ props: { body: "Only Bob's rogue notices this" } });
  });

  it("computeBlocksVision matches the client registry's wall/door truth table", () => {
    expect(computeBlocksVision({ type: 'wall', props: {} })).toBe(true);
    expect(computeBlocksVision({ type: 'door', props: { state: 'open' } })).toBe(false);
    expect(computeBlocksVision({ type: 'door', props: { state: 'closed' } })).toBe(true);
    expect(computeBlocksVision({ type: 'door', props: { state: 'locked' } })).toBe(true);
    expect(computeBlocksVision({ type: 'light', props: {} })).toBe(false);
    expect(computeBlocksVision({ type: 'area', props: {} })).toBe(false);
    expect(computeBlocksVision({ type: 'note', props: {} })).toBe(false);
    expect(computeBlocksVision({ type: 'image', props: {} })).toBe(false);
  });
});

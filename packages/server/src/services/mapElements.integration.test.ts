// Integration test for the generic map-elements CRUD layer (see
// mapElements.ts's header comments for the map_id-scoping and
// bumpLinkedEncounters fan-out rationale). Covers: CRUD round-trip, map-id
// scoping (an element from map A never leaks into map B's list even when
// both maps' encounters are queried), and broadcast fan-out (a mutation on
// a map linked to two live encounters bumps and reports both). Throwaway
// campaign/encounter/map fixtures, same isolation convention as
// encounters.movementMode.integration.test.ts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { createEncounter } from './encounters.js';
import { createMap, linkMapToEncounter, setActiveMap } from './maps.js';
import { createMapElement, deleteMapElement, listMapElements, updateMapElement } from './mapElements.js';

describe('map elements CRUD (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let encounterAId: string; // shares mapId
  let encounterBId: string; // shares mapId
  let mapId: string;
  let otherEncounterId: string; // its own, unrelated map
  let otherMapId: string;

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'MapElements Test DM', 'x') RETURNING id`,
      [`map-elements-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('MapElements Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;

    const map = await createMap(pool, campaignId, { name: 'Shared Map' });
    mapId = map.id;
    const otherMap = await createMap(pool, campaignId, { name: 'Unrelated Map' });
    otherMapId = otherMap.id;

    const encounterA = await createEncounter(pool, campaignId, { name: 'Encounter A' });
    encounterAId = encounterA.id;
    const encounterB = await createEncounter(pool, campaignId, { name: 'Encounter B' });
    encounterBId = encounterB.id;
    const otherEncounter = await createEncounter(pool, campaignId, { name: 'Unrelated Encounter' });
    otherEncounterId = otherEncounter.id;

    // Both A and B are linked to and have active the SAME map, so a mutation
    // on it must fan out to both. otherEncounter gets its own separate map.
    await linkMapToEncounter(pool, encounterAId, mapId);
    await setActiveMap(pool, encounterAId, mapId);
    await linkMapToEncounter(pool, encounterBId, mapId);
    await setActiveMap(pool, encounterBId, mapId);
    await linkMapToEncounter(pool, otherEncounterId, otherMapId);
    await setActiveMap(pool, otherEncounterId, otherMapId);
  });

  afterAll(async () => {
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  it('creates a wall element and fans the sync_seq bump out to every encounter linked to the map', async () => {
    const before = await pool.query<{ sync_seq: number }>(`SELECT sync_seq FROM encounters WHERE id = $1`, [encounterAId]);
    const seqBefore = before.rows[0]!.sync_seq;

    const { element, affectedEncounters } = await createMapElement(pool, encounterAId, {
      type: 'wall',
      x1: 0, y1: 0, x2: 5, y2: 0,
    });

    expect(element.type).toBe('wall');
    expect(element.map_id).toBe(mapId);

    const ids = affectedEncounters.map((e) => e.id).sort();
    expect(ids).toEqual([encounterAId, encounterBId].sort());
    const bumpedA = affectedEncounters.find((e) => e.id === encounterAId)!;
    expect(bumpedA.sync_seq).toBe(seqBefore + 1);
  });

  it('a door round-trips its props and merges partial prop updates without clobbering the rest', async () => {
    const { element: created } = await createMapElement(pool, encounterAId, {
      type: 'door',
      x1: 1, y1: 1, x2: 1, y2: 2,
      props: { state: 'closed' },
    });
    expect(created.props).toEqual({ state: 'closed' });

    const { element: updated } = await updateMapElement(pool, encounterAId, created.id, {
      props: { state: 'open' },
    });
    expect(updated.props).toEqual({ state: 'open' });
    // Geometry untouched by an update that only patched props.
    expect(updated.x1).toBe(1);
    expect(updated.x2).toBe(1);
  });

  it('an area element stores its polygon in points and anchors x1/y1 to the first vertex', async () => {
    const points = [{ x: 2, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 4 }];
    const { element } = await createMapElement(pool, encounterAId, {
      type: 'area',
      points,
      props: { shape: 'polygon', costType: 'difficult', color: '#663399' },
    });
    expect(element.points).toEqual(points);
    expect(element.x1).toBe(2);
    expect(element.y1).toBe(2);
  });

  it('lists elements ordered and scoped strictly to their own map — an element on another map never leaks in', async () => {
    await createMapElement(pool, otherEncounterId, { type: 'wall', x1: 9, y1: 9, x2: 10, y2: 9 });

    const listA = await listMapElements(pool, encounterAId);
    const listOther = await listMapElements(pool, otherEncounterId);

    expect(listA.every((el) => el.map_id === mapId)).toBe(true);
    expect(listOther.every((el) => el.map_id === otherMapId)).toBe(true);
    expect(listA.some((el) => el.map_id === otherMapId)).toBe(false);
  });

  it('listing elements via encounter B (linked to the same map as A) sees the elements A created', async () => {
    const listB = await listMapElements(pool, encounterBId);
    expect(listB.some((el) => el.type === 'wall')).toBe(true);
    expect(listB.some((el) => el.type === 'door')).toBe(true);
  });

  it('deletes an element and fans the sync_seq bump out the same way create/update do', async () => {
    const { element } = await createMapElement(pool, encounterAId, { type: 'wall', x1: 0, y1: 0, x2: 1, y2: 1 });

    const result = await deleteMapElement(pool, encounterAId, element.id);
    expect(result).not.toBeNull();
    const ids = result!.affectedEncounters.map((e) => e.id).sort();
    expect(ids).toEqual([encounterAId, encounterBId].sort());

    const listAfter = await listMapElements(pool, encounterAId);
    expect(listAfter.find((el) => el.id === element.id)).toBeUndefined();
  });

  it('deleting a non-existent element id returns null rather than throwing', async () => {
    const result = await deleteMapElement(pool, encounterAId, '00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });
});

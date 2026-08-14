// Integration tests for the batched monster spawn service (Iteration 2,
// "Fast add/spawn UX" — see docs/rules/monster-spawning.md for the
// HP-strategy/group-initiative rules basis). Throwaway campaign/user/monster
// fixtures, same isolation convention as encounters.disposition.integration
// .test.ts. DM-only route authorization for POST /:id/spawn is
// Express-middleware-only (requireEncounterDm, no service-level check) — per
// this codebase's established convention (see
// encounters.startCombat.integration.test.ts's own note), not re-verified
// here.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../db/pool.js';
import { addParticipant, createEncounter, startCombat, startEncounter } from './encounters.js';
import { spawnParticipants } from './spawn.js';

interface InstanceRow {
  custom_name: string | null;
  hp_current: number;
}

async function fetchInstances(participantIds: string[]): Promise<InstanceRow[]> {
  const participantsRes = await pool.query<{ monster_instance_id: string }>(
    `SELECT monster_instance_id FROM combat_participants WHERE id = ANY($1::uuid[])`,
    [participantIds],
  );
  const instanceIds = participantsRes.rows.map((r) => r.monster_instance_id);
  const instancesRes = await pool.query<InstanceRow>(
    `SELECT custom_name, hp_current FROM monster_instances WHERE id = ANY($1::uuid[])`,
    [instanceIds],
  );
  return instancesRes.rows;
}

describe('spawnParticipants (integration, live DB, throwaway fixtures)', () => {
  let dmUserId: string;
  let campaignId: string;
  let goblinId: string;
  let uniqueBossId: string;
  let uncuratedMonsterId: string; // never added to campaign_bestiary_entries

  beforeAll(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const dmRes = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Spawn Test DM', 'x') RETURNING id`,
      [`spawn-dm-${suffix}@example.test`],
    );
    dmUserId = dmRes.rows[0]!.id;

    const campaignRes = await pool.query<{ id: string }>(
      `INSERT INTO campaigns (name, dm_user_id, srd_edition) VALUES ('Spawn Test Campaign', $1, '2024') RETURNING id`,
      [dmUserId],
    );
    campaignId = campaignRes.rows[0]!.id;
    await pool.query(`INSERT INTO campaign_members (campaign_id, user_id, role) VALUES ($1, $2, 'dm')`, [campaignId, dmUserId]);

    // dex=14 -> dexModifier=+2, hit_dice='2d6' -> rolled HP always in [2,12].
    const goblinRes = await pool.query<{ id: string }>(
      `INSERT INTO monsters
         (slug, name, edition_scope, size, creature_type, armor_class, hit_point_average, hit_dice, speed,
          str, dex, con, int, wis, cha, challenge_rating, xp_value, actions)
       VALUES ($1, 'Spawn Test Goblin', 'both', 'Small', 'humanoid', 15, 7, '2d6', '{"walk":30}',
               8, 14, 10, 10, 8, 8, 0.25, 50, '[{"name":"Scimitar","description":"Melee."}]')
       RETURNING id`,
      [`spawn-test-goblin-${suffix}`],
    );
    goblinId = goblinRes.rows[0]!.id;

    const bossRes = await pool.query<{ id: string }>(
      `INSERT INTO monsters
         (slug, name, edition_scope, size, creature_type, armor_class, hit_point_average, hit_dice, speed,
          str, dex, con, int, wis, cha, challenge_rating, xp_value, actions, is_unique)
       VALUES ($1, 'Spawn Test Boss', 'both', 'Medium', 'humanoid', 18, 50, '8d8+16', '{"walk":30}',
               16, 12, 16, 10, 10, 14, 5, 1800, '[{"name":"Greatsword","description":"Melee."}]', true)
       RETURNING id`,
      [`spawn-test-boss-${suffix}`],
    );
    uniqueBossId = bossRes.rows[0]!.id;

    const uncuratedRes = await pool.query<{ id: string }>(
      `INSERT INTO monsters
         (slug, name, edition_scope, size, creature_type, armor_class, hit_point_average, hit_dice, speed,
          str, dex, con, int, wis, cha, challenge_rating, xp_value, actions)
       VALUES ($1, 'Spawn Test Uncurated Monster', 'both', 'Small', 'humanoid', 15, 7, '2d6', '{"walk":30}',
               8, 14, 10, 10, 8, 8, 0.25, 50, '[{"name":"Dagger","description":"Melee."}]')
       RETURNING id`,
      [`spawn-test-uncurated-${suffix}`],
    );
    uncuratedMonsterId = uncuratedRes.rows[0]!.id;

    // spawnParticipants now requires campaign-bestiary curation — see
    // assertMonsterCuratedInBestiary (services/campaignBestiary.ts).
    // uncuratedMonsterId is deliberately NOT added here, to cover rejection.
    await pool.query(
      `INSERT INTO campaign_bestiary_entries (campaign_id, monster_id) VALUES ($1, $2), ($1, $3)`,
      [campaignId, goblinId, uniqueBossId],
    );
  });

  afterAll(async () => {
    // Campaign cascade clears monster_instances/combat_participants/encounters
    // first, so the monsters catalog rows themselves (global, not
    // campaign-scoped — see services/monsters.ts's uniqueness check spanning
    // all campaigns) can be deleted afterward without an FK violation.
    if (campaignId) await pool.query(`DELETE FROM campaigns WHERE id = $1`, [campaignId]);
    await pool.query(`DELETE FROM monsters WHERE id = ANY($1::uuid[])`, [[goblinId, uniqueBossId, uncuratedMonsterId]]);
    if (dmUserId) await pool.query(`DELETE FROM users WHERE id = $1`, [dmUserId]);
    await pool.end();
  });

  it('spawns N monster instances and N combat participants, defaulting to average HP', async () => {
    const encounter = await createEncounter(pool, campaignId, { name: 'Average HP Encounter' });
    const before = await pool.query<{ sync_seq: number }>(`SELECT sync_seq FROM encounters WHERE id = $1`, [encounter.id]);

    const { encounter: after, participants } = await spawnParticipants(pool, encounter.id, {
      monsterId: goblinId,
      quantity: 3,
      hpStrategy: 'average',
      groupInitiative: true,
      namingScheme: 'numeric',
    });

    expect(participants).toHaveLength(3);
    expect(after.sync_seq).toBe(before.rows[0]!.sync_seq + 1);
    expect(new Set(participants.map((p) => p.turn_order))).toEqual(new Set([0, 1, 2]));
    for (const p of participants) expect(p.faction).toBe('enemy');

    const instances = await fetchInstances(participants.map((p) => p.id));
    for (const instance of instances) expect(instance.hp_current).toBe(7);
    expect(new Set(instances.map((i) => i.custom_name)).size).toBe(3); // no name collisions
  });

  it('rejects spawning a monster that is not curated into this campaign\'s bestiary', async () => {
    const encounter = await createEncounter(pool, campaignId, { name: 'Uncurated Monster Encounter' });

    await expect(
      spawnParticipants(pool, encounter.id, {
        monsterId: uncuratedMonsterId,
        quantity: 1,
        hpStrategy: 'average',
        groupInitiative: true,
        namingScheme: 'numeric',
      }),
    ).rejects.toMatchObject({ code: 'NOT_IN_BESTIARY' });
  });

  it('hpStrategy "rolled" produces independently-rolled HP per instance', async () => {
    const encounter = await createEncounter(pool, campaignId, { name: 'Rolled HP Encounter' });
    const { participants } = await spawnParticipants(pool, encounter.id, {
      monsterId: goblinId,
      quantity: 8,
      hpStrategy: 'rolled',
      groupInitiative: true,
      namingScheme: 'numeric',
    });

    const instances = await fetchInstances(participants.map((p) => p.id));
    for (const instance of instances) expect(instance.hp_current).toBeGreaterThanOrEqual(2); // 2d6 floor
    for (const instance of instances) expect(instance.hp_current).toBeLessThanOrEqual(12); // 2d6 ceiling
    // Astronomically unlikely all 8 independent 2d6 rolls land on the same
    // total — a real assertion that rolling happened per-instance, not once.
    expect(new Set(instances.map((i) => i.hp_current)).size).toBeGreaterThan(1);
  });

  it('hpStrategy "same" rolls once and reuses that result for the whole batch', async () => {
    const encounter = await createEncounter(pool, campaignId, { name: 'Same HP Encounter' });
    const { participants } = await spawnParticipants(pool, encounter.id, {
      monsterId: goblinId,
      quantity: 5,
      hpStrategy: 'same',
      groupInitiative: true,
      namingScheme: 'numeric',
    });

    const instances = await fetchInstances(participants.map((p) => p.id));
    const distinctHp = new Set(instances.map((i) => i.hp_current));
    expect(distinctHp.size).toBe(1);
    expect(instances[0]!.hp_current).toBeGreaterThanOrEqual(2);
    expect(instances[0]!.hp_current).toBeLessThanOrEqual(12);
  });

  it('groupInitiative true shares one initiative roll and tiebreak across the batch', async () => {
    const encounter = await createEncounter(pool, campaignId, { name: 'Group Initiative Encounter' });
    const { participants } = await spawnParticipants(pool, encounter.id, {
      monsterId: goblinId,
      quantity: 4,
      hpStrategy: 'average',
      groupInitiative: true,
      namingScheme: 'numeric',
    });

    expect(new Set(participants.map((p) => p.initiative_roll)).size).toBe(1);
    expect(new Set(participants.map((p) => p.initiative_tiebreak)).size).toBe(1);
    expect(participants[0]!.initiative_tiebreak).toBe(2); // dexModifier(14) === +2
  });

  it('groupInitiative false rolls initiative independently per instance', async () => {
    const encounter = await createEncounter(pool, campaignId, { name: 'Independent Initiative Encounter' });
    const { participants } = await spawnParticipants(pool, encounter.id, {
      monsterId: goblinId,
      quantity: 8,
      hpStrategy: 'average',
      groupInitiative: false,
      namingScheme: 'numeric',
    });

    // Every tiebreak is still the same (same monster -> same dex mod); only
    // the d20 half of the roll should vary independently.
    expect(new Set(participants.map((p) => p.initiative_tiebreak)).size).toBe(1);
    expect(new Set(participants.map((p) => p.initiative_roll)).size).toBeGreaterThan(1);
  });

  it('auto-numbering continues from the existing per-campaign count and never collides within a batch', async () => {
    const encounter = await createEncounter(pool, campaignId, { name: 'Numbering Encounter' });
    const before = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM monster_instances WHERE campaign_id = $1 AND monster_id = $2`,
      [campaignId, goblinId],
    );
    const startCount = Number(before.rows[0]!.count);

    const { participants } = await spawnParticipants(pool, encounter.id, {
      monsterId: goblinId,
      quantity: 3,
      hpStrategy: 'average',
      groupInitiative: true,
      namingScheme: 'numeric',
    });

    const instances = await fetchInstances(participants.map((p) => p.id));
    const names = instances.map((i) => i.custom_name).sort();
    expect(names).toEqual([
      `Spawn Test Goblin ${startCount + 1}`,
      `Spawn Test Goblin ${startCount + 2}`,
      `Spawn Test Goblin ${startCount + 3}`,
    ]);
  });

  it('alpha naming scheme labels the batch A, B, C, ... from the current offset', async () => {
    const encounter = await createEncounter(pool, campaignId, { name: 'Alpha Naming Encounter' });
    const before = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM monster_instances WHERE campaign_id = $1 AND monster_id = $2`,
      [campaignId, goblinId],
    );
    const startCount = Number(before.rows[0]!.count);
    const expectedLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

    const { participants } = await spawnParticipants(pool, encounter.id, {
      monsterId: goblinId,
      quantity: 3,
      hpStrategy: 'average',
      groupInitiative: true,
      namingScheme: 'alpha',
    });

    const instances = await fetchInstances(participants.map((p) => p.id));
    const names = instances.map((i) => i.custom_name).sort();
    expect(names).toEqual(
      [0, 1, 2].map((i) => `Spawn Test Goblin ${expectedLetters[(startCount + i) % expectedLetters.length]}`).sort(),
    );
  });

  it('customBaseName overrides the monster name in the numbering scheme', async () => {
    const encounter = await createEncounter(pool, campaignId, { name: 'Custom Base Name Encounter' });
    const { participants } = await spawnParticipants(pool, encounter.id, {
      monsterId: goblinId,
      quantity: 2,
      hpStrategy: 'average',
      groupInitiative: true,
      customBaseName: 'Ambush Party',
      namingScheme: 'numeric',
    });

    const instances = await fetchInstances(participants.map((p) => p.id));
    expect(instances.map((i) => i.custom_name).sort()).toEqual(['Ambush Party 1', 'Ambush Party 2']);
  });

  it('resequences turn_order by initiative when spawning into an already-active combat', async () => {
    const encounter = await createEncounter(pool, campaignId, { name: 'Active Combat Spawn Encounter' });
    await startEncounter(pool, encounter.id);

    const seededInstanceRes = await pool.query<{ id: string }>(
      `INSERT INTO monster_instances (campaign_id, monster_id, custom_name, hp_current, hp_temp, status, is_recurring)
       VALUES ($1, $2, 'Seed Goblin', 7, 0, 'alive', false) RETURNING id`,
      [campaignId, goblinId],
    );
    await addParticipant(pool, encounter.id, { monsterInstanceId: seededInstanceRes.rows[0]!.id });
    await startCombat(pool, encounter.id);

    const { participants } = await spawnParticipants(pool, encounter.id, {
      monsterId: goblinId,
      quantity: 2,
      hpStrategy: 'average',
      groupInitiative: true,
      namingScheme: 'numeric',
    });

    const allRes = await pool.query<{ turn_order: number }>(
      `SELECT turn_order FROM combat_participants WHERE encounter_id = $1 ORDER BY turn_order ASC`,
      [encounter.id],
    );
    const turnOrders = allRes.rows.map((r) => r.turn_order);
    expect(turnOrders).toEqual([...turnOrders].sort((a, b) => a - b));
    expect(new Set(turnOrders).size).toBe(turnOrders.length); // dense, no duplicates
    expect(participants).toHaveLength(2);
  });

  it('rejects spawning a unique monster with quantity > 1', async () => {
    const encounter = await createEncounter(pool, campaignId, { name: 'Unique Quantity Encounter' });
    await expect(
      spawnParticipants(pool, encounter.id, {
        monsterId: uniqueBossId,
        quantity: 2,
        hpStrategy: 'average',
        groupInitiative: true,
        namingScheme: 'numeric',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects spawning a unique monster that already has a living instance elsewhere', async () => {
    const encounterA = await createEncounter(pool, campaignId, { name: 'Unique First Spawn Encounter' });
    await spawnParticipants(pool, encounterA.id, {
      monsterId: uniqueBossId,
      quantity: 1,
      hpStrategy: 'average',
      groupInitiative: true,
      namingScheme: 'numeric',
    });

    const encounterB = await createEncounter(pool, campaignId, { name: 'Unique Second Spawn Encounter' });
    await expect(
      spawnParticipants(pool, encounterB.id, {
        monsterId: uniqueBossId,
        quantity: 1,
        hpStrategy: 'average',
        groupInitiative: true,
        namingScheme: 'numeric',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('throws NOT_FOUND for a nonexistent encounter', async () => {
    await expect(
      spawnParticipants(pool, '00000000-0000-0000-0000-000000000000', {
        monsterId: goblinId,
        quantity: 1,
        hpStrategy: 'average',
        groupInitiative: true,
        namingScheme: 'numeric',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws NOT_FOUND for a nonexistent monster', async () => {
    const encounter = await createEncounter(pool, campaignId, { name: 'Bad Monster Encounter' });
    await expect(
      spawnParticipants(pool, encounter.id, {
        monsterId: '00000000-0000-0000-0000-000000000000',
        quantity: 1,
        hpStrategy: 'average',
        groupInitiative: true,
        namingScheme: 'numeric',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

import type { Pool } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import { requireMembership, requireDm, type CampaignRole } from './authz.js';
import { applyHpDeltaWithTempAbsorption } from './hp.js';
import { redactHpFields, resolveHpVisibility } from './hpVisibility.js';
import { redactEntityFields, resolveReveals } from './entityFieldReveal.js';
import { MONSTER_INSTANCE_STAT_BLOCK_SQL } from '../domain/revealFields.js';
import type {
  CreateMonsterInstanceInput,
  MonsterInstanceHpDeltaInput,
  UpdateMonsterInstanceInput,
} from '../schemas/monsters.js';

// Reveal-gated stat-block fields (MONSTER_INSTANCE_REVEALABLE_FIELDS) live
// on the shared `monsters` catalog row, not on `monster_instances` —
// PLAN.md §3.1's catalog/instance split. Neither list/get query below
// selected them at all before the reveal engine (only name/slug/
// challenge_rating/hit_point_average were joined in for display), so both
// now join the full stat block in per-instance via the shared SQL fragment
// (see its comment in domain/revealFields.ts for why it lives there).
const MONSTER_STAT_BLOCK_JOIN = MONSTER_INSTANCE_STAT_BLOCK_SQL;

interface MonsterInstanceRow {
  id: number;
  campaign_id: number;
  hp_current: number;
  hp_temp: number;
  hp_max_override: number | null;
  [key: string]: unknown;
}

// Scoped by campaign_id (not just id) so a monster instance belonging to a
// DIFFERENT campaign 404s instead of leaking cross-campaign existence, even
// if the actor happens to also be a member of that other campaign — the URL
// asserts "this instance belongs to campaign :id" and that must hold.
async function fetchScopedInstanceOrThrow(pool: Pool, campaignId: number, instanceId: number): Promise<MonsterInstanceRow> {
  const result = await pool.query<MonsterInstanceRow>(
    `SELECT * FROM monster_instances WHERE id = $1 AND campaign_id = $2`,
    [instanceId, campaignId],
  );
  const row = result.rows[0];
  if (!row) throw notFound('Monster instance');
  return row;
}

async function fetchInstanceOrThrow(pool: Pool, instanceId: number): Promise<MonsterInstanceRow> {
  const result = await pool.query<MonsterInstanceRow>(`SELECT * FROM monster_instances WHERE id = $1`, [instanceId]);
  const row = result.rows[0];
  if (!row) throw notFound('Monster instance');
  return row;
}

// Monster instances have no "PC" concept — every one is subject to
// hp_visibility banding for players (unlike characters, where a PC is always
// exact). See services/hpVisibility.ts.
export async function listMonsterInstances(pool: Pool, campaignId: number, role: CampaignRole) {
  const result = await pool.query(
    `SELECT mi.*, m.name AS monster_name, m.slug AS monster_slug, m.challenge_rating, m.hit_point_average,
            ${MONSTER_STAT_BLOCK_JOIN}
     FROM monster_instances mi
     JOIN monsters m ON m.id = mi.monster_id
     WHERE mi.campaign_id = $1
     ORDER BY mi.created_at ASC`,
    [campaignId],
  );
  if (role === 'dm') return result.rows.map((row) => ({ ...row, hp_band: null }));
  return Promise.all(
    result.rows.map(async (row) => {
      const effectiveMax = row.hp_max_override ?? row.hit_point_average;
      const visibility = await resolveHpVisibility(pool, { monsterInstanceId: row.id });
      const hpRedacted = redactHpFields({ ...row, hp_max: effectiveMax }, visibility);
      const revealState = await resolveReveals(pool, campaignId, 'monster_instance', { monsterInstanceId: row.id });
      return redactEntityFields(hpRedacted, 'monster_instance', revealState);
    }),
  );
}

// campaignId here comes from the already-authorized /campaigns/:id/... route
// (requireCampaignMember/requireRole already ran); these just add the
// campaign-scoping 404 described above.

export async function getMonsterInstance(pool: Pool, campaignId: number, instanceId: number, role: CampaignRole) {
  const instance = await fetchScopedInstanceOrThrow(pool, campaignId, instanceId);
  const statBlockRow = await pool.query(
    `SELECT COALESCE(mi.hp_max_override, m.hit_point_average) AS hp_max, ${MONSTER_STAT_BLOCK_JOIN}
     FROM monster_instances mi JOIN monsters m ON m.id = mi.monster_id WHERE mi.id = $1`,
    [instanceId],
  );
  const statBlock = statBlockRow.rows[0]!;
  if (role === 'dm') return { ...instance, ...statBlock, hp_band: null };
  const visibility = await resolveHpVisibility(pool, { monsterInstanceId: instanceId });
  const hpRedacted = redactHpFields({ ...instance, ...statBlock }, visibility);
  const revealState = await resolveReveals(pool, campaignId, 'monster_instance', { monsterInstanceId: instanceId });
  return redactEntityFields(hpRedacted, 'monster_instance', revealState);
}

// Locks the catalog `monsters` row for the duration of the check+insert so
// two concurrent spawns of the same is_unique monster can't both pass the
// "no existing instance yet" check before either commits (the row lock
// serializes the second caller behind the first). The lock is on the shared
// catalog row, not the campaign's instances, but since campaignId is part of
// the count query the lock only ever gates spawns of THIS monster, not
// unrelated concurrent activity.
export async function createMonsterInstance(
  pool: Pool,
  campaignId: number,
  input: CreateMonsterInstanceInput,
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const monsterResult = await client.query<{ name: string; is_unique: boolean }>(
      `SELECT name, is_unique FROM monsters WHERE id = $1 FOR UPDATE`,
      [input.monsterId],
    );
    const monster = monsterResult.rows[0];
    if (!monster) throw notFound('Monster');

    const existingCount = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM monster_instances WHERE campaign_id = $1 AND monster_id = $2`,
      [campaignId, input.monsterId],
    );
    const count = Number(existingCount.rows[0]!.count);

    if (monster.is_unique && count > 0) {
      throw new AppError('CONFLICT', `${monster.name} is unique and already has an active instance in this campaign`);
    }

    // Auto-label duplicates ("Goblin 1", "Goblin 2", ...) only when the
    // caller didn't supply a name — a unique monster never needs numbering
    // since count is always 0 at this point.
    const customName = input.customName ?? (monster.is_unique ? null : `${monster.name} ${count + 1}`);

    const result = await client.query(
      `INSERT INTO monster_instances
         (campaign_id, monster_id, custom_name, hp_max_override, armor_class_override, hp_current, hp_temp, status, is_recurring, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        campaignId, input.monsterId, customName, input.hpMaxOverride ?? null, input.armorClassOverride ?? null,
        input.hpCurrent, input.hpTemp, input.status, input.isRecurring, input.notes ?? null,
      ],
    );

    await client.query('COMMIT');
    return result.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const UPDATABLE_COLUMNS: Record<string, string> = {
  customName: 'custom_name',
  hpMaxOverride: 'hp_max_override',
  // Phase 3.5: flat manual AC override, same pattern as hpMaxOverride above
  // — no auto-recompute path exists for monster instances (see
  // services/armorClass.ts's scope note).
  armorClassOverride: 'armor_class_override',
  hpCurrent: 'hp_current',
  hpTemp: 'hp_temp',
  status: 'status',
  isRecurring: 'is_recurring',
  notes: 'notes',
};

export async function updateMonsterInstance(
  pool: Pool,
  campaignId: number,
  instanceId: number,
  input: UpdateMonsterInstanceInput,
) {
  await fetchScopedInstanceOrThrow(pool, campaignId, instanceId);

  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    const column = UPDATABLE_COLUMNS[key];
    if (!column) continue;
    sets.push(`${column} = $${i++}`);
    values.push(value);
  }
  if (sets.length === 0) return fetchScopedInstanceOrThrow(pool, campaignId, instanceId);

  values.push(instanceId);
  const result = await pool.query(`UPDATE monster_instances SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, values);
  return result.rows[0];
}

export async function deleteMonsterInstance(pool: Pool, campaignId: number, instanceId: number): Promise<void> {
  await fetchScopedInstanceOrThrow(pool, campaignId, instanceId);
  await pool.query(`DELETE FROM monster_instances WHERE id = $1`, [instanceId]);
}

// See characters.ts's applyHpDelta for why this returns an array of
// per-encounter sync targets rather than a single seq: a monster instance's
// combat_participants row is per-encounter, and its sync_seq bump happens in
// the SAME transaction as the HP update (PLAN.md §5.2).
export interface EncounterHpSyncTarget {
  encounter_id: number;
  campaign_id: number;
  sync_seq: number;
  participant_id: number;
  hp_visibility: 'exact' | 'banded' | 'hidden';
}

export interface ApplyMonsterInstanceHpDeltaResult {
  monsterInstance: Record<string, unknown>;
  encounterSyncs: EncounterHpSyncTarget[];
}

// Flat /monster-instances/:id/hp route has no campaignId in the URL, so this
// one still derives the campaign from the row itself and checks membership +
// DM role directly (HP tracking for monsters is DM-only, same as any NPC).
export async function applyMonsterInstanceHpDelta(
  pool: Pool,
  actorId: number,
  instanceId: number,
  input: MonsterInstanceHpDeltaInput,
): Promise<ApplyMonsterInstanceHpDeltaResult> {
  const instance = await fetchInstanceOrThrow(pool, instanceId);
  const role = await requireMembership(pool, instance.campaign_id, actorId);
  requireDm(role);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const locked = await client.query<{ hp_current: number; hp_temp: number; hp_max: number }>(
      `SELECT mi.hp_current, mi.hp_temp, COALESCE(mi.hp_max_override, m.hit_point_average) AS hp_max
       FROM monster_instances mi JOIN monsters m ON m.id = mi.monster_id
       WHERE mi.id = $1 FOR UPDATE OF mi`,
      [instanceId],
    );
    const { hpCurrent, hpTemp } = applyHpDeltaWithTempAbsorption(locked.rows[0], input);

    const result = await client.query(
      `UPDATE monster_instances mi
       SET hp_current = $1,
           hp_temp = $2
       FROM monsters m
       WHERE mi.id = $3 AND m.id = mi.monster_id
       RETURNING mi.*, m.hit_point_average`,
      [hpCurrent, hpTemp, instanceId],
    );

    const encounterSyncs = await client.query<EncounterHpSyncTarget>(
      `UPDATE encounters e
       SET sync_seq = sync_seq + 1
       FROM combat_participants cp
       WHERE cp.monster_instance_id = $1 AND cp.encounter_id = e.id
       RETURNING e.id AS encounter_id, e.campaign_id, e.sync_seq, cp.id AS participant_id, cp.hp_visibility`,
      [instanceId],
    );

    await client.query('COMMIT');
    return { monsterInstance: result.rows[0], encounterSyncs: encounterSyncs.rows };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

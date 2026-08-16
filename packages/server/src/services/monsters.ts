import type { Pool } from 'pg';
import { AppError, notFound } from '../middleware/errors.js';
import { requireMembership, requireDm, type CampaignRole } from './authz.js';
import { authorizeAttackerOnTurn } from './encounters.js';
import { createPendingAction, type PendingActionCreated } from './pendingActions.js';
import { applyHpDeltaWithTempAbsorption } from './hp.js';
import { redactEntityFields, resolveReveals } from './entityFieldReveal.js';
import { MONSTER_INSTANCE_STAT_BLOCK_SQL } from '../domain/revealFields.js';
import { computeAppliedDamage } from './damage.js';
import { rollDie, deriveIsCriticalFromAttackRoll } from './diceRolls.js';
import { criticalDiceCount } from './diceEngine.js';
import { computeConcentrationDc, findActiveConcentrationEffect } from './concentration.js';
import type {
  CreateMonsterInstanceInput,
  MonsterInstanceHpDeltaInput,
  UpdateMonsterInstanceInput,
} from '../schemas/monsters.js';
import type { ApplyDamageInput } from '../schemas/damage.js';

// Reveal-gated stat-block fields (MONSTER_INSTANCE_REVEALABLE_FIELDS) live
// on the shared `monsters` catalog row, not on `monster_instances` —
// PLAN.md §3.1's catalog/instance split. Neither list/get query below
// selected them at all before the reveal engine (only name/slug/
// challenge_rating/hit_point_average were joined in for display), so both
// now join the full stat block in per-instance via the shared SQL fragment
// (see its comment in domain/revealFields.ts for why it lives there).
const MONSTER_STAT_BLOCK_JOIN = MONSTER_INSTANCE_STAT_BLOCK_SQL;

interface MonsterInstanceRow {
  id: string;
  campaign_id: string;
  hp_current: number;
  hp_temp: number;
  hp_max_override: number | null;
  [key: string]: unknown;
}

// Scoped by campaign_id (not just id) so a monster instance belonging to a
// DIFFERENT campaign 404s instead of leaking cross-campaign existence, even
// if the actor happens to also be a member of that other campaign — the URL
// asserts "this instance belongs to campaign :id" and that must hold.
async function fetchScopedInstanceOrThrow(pool: Pool, campaignId: string, instanceId: string): Promise<MonsterInstanceRow> {
  const result = await pool.query<MonsterInstanceRow>(
    `SELECT * FROM monster_instances WHERE id = $1 AND campaign_id = $2`,
    [instanceId, campaignId],
  );
  const row = result.rows[0];
  if (!row) throw notFound('Monster instance');
  return row;
}

async function fetchInstanceOrThrow(pool: Pool, instanceId: string): Promise<MonsterInstanceRow> {
  const result = await pool.query<MonsterInstanceRow>(`SELECT * FROM monster_instances WHERE id = $1`, [instanceId]);
  const row = result.rows[0];
  if (!row) throw notFound('Monster instance');
  return row;
}

// HP is always visible now (hide/reveal was removed) — the only remaining
// redaction is the three weakness fields (damage vulnerabilities/
// resistances/immunities), still DM-only until revealed.
export async function listMonsterInstances(pool: Pool, campaignId: string, role: CampaignRole) {
  const result = await pool.query(
    `SELECT mi.*, m.name AS monster_name, m.slug AS monster_slug, m.challenge_rating, m.hit_point_average,
            ${MONSTER_STAT_BLOCK_JOIN}
     FROM monster_instances mi
     JOIN monsters m ON m.id = mi.monster_id
     WHERE mi.campaign_id = $1
     ORDER BY mi.created_at ASC`,
    [campaignId],
  );
  const rows = result.rows.map((row) => ({ ...row, hp_max: row.hp_max_override ?? row.hit_point_average }));
  if (role === 'dm') return rows;
  return Promise.all(
    rows.map(async (row) => {
      const revealState = await resolveReveals(pool, campaignId, row.id);
      return redactEntityFields(row, revealState);
    }),
  );
}

// campaignId here comes from the already-authorized /campaigns/:id/... route
// (requireCampaignMember/requireRole already ran); these just add the
// campaign-scoping 404 described above.

export async function getMonsterInstance(pool: Pool, campaignId: string, instanceId: string, role: CampaignRole) {
  const instance = await fetchScopedInstanceOrThrow(pool, campaignId, instanceId);
  const statBlockRow = await pool.query(
    `SELECT COALESCE(mi.hp_max_override, m.hit_point_average) AS hp_max, ${MONSTER_STAT_BLOCK_JOIN}
     FROM monster_instances mi JOIN monsters m ON m.id = mi.monster_id WHERE mi.id = $1`,
    [instanceId],
  );
  const statBlock = statBlockRow.rows[0]!;
  const merged = { ...instance, ...statBlock };
  if (role === 'dm') return merged;
  const revealState = await resolveReveals(pool, campaignId, instanceId);
  return redactEntityFields(merged, revealState);
}

// Locks the catalog `monsters` row for the duration of the check+insert so
// two concurrent spawns of the same is_unique monster can't both pass the
// "no living instance yet" check before either commits (the row lock
// serializes the second caller behind the first). Global (all campaigns
// share one lock on this row), which is exactly what a system-wide
// uniqueness check needs — see the uniqueLiving query below.
export async function createMonsterInstance(
  pool: Pool,
  campaignId: string,
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

    // REFACTOR-PLAN.md §2 fix: this used to be scoped `campaign_id = $1` and
    // count every status, which had it backwards on both axes — a dead
    // unique NPC in THIS campaign wrongly blocked a legitimate respawn, while
    // the same named boss could still exist simultaneously in a DIFFERENT
    // campaign. "Unique" means unique across the whole system, among LIVING
    // instances only.
    if (monster.is_unique) {
      const uniqueLiving = await client.query<{ campaign_id: string; campaign_name: string }>(
        `SELECT mi.campaign_id, c.name AS campaign_name
         FROM monster_instances mi
         JOIN campaigns c ON c.id = mi.campaign_id
         WHERE mi.monster_id = $1 AND mi.status = 'alive'
         LIMIT 1`,
        [input.monsterId],
      );
      const existing = uniqueLiving.rows[0];
      if (existing) {
        throw new AppError(
          'CONFLICT',
          `${monster.name} is unique and already has a living instance in campaign "${existing.campaign_name}" (id ${existing.campaign_id})`,
          { existingCampaignId: existing.campaign_id },
        );
      }
    }

    // Auto-label duplicates ("Goblin 1", "Goblin 2", ...) only when the
    // caller didn't supply a name — scoped to THIS campaign (unrelated to the
    // system-wide uniqueness check above; numbering across campaigns
    // wouldn't mean anything to the DM reading it). A unique monster never
    // needs numbering, so this count is never consulted for one.
    const existingInCampaign = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM monster_instances WHERE campaign_id = $1 AND monster_id = $2`,
      [campaignId, input.monsterId],
    );
    const countInCampaign = Number(existingInCampaign.rows[0]!.count);
    const customName = input.customName ?? (monster.is_unique ? null : `${monster.name} ${countInCampaign + 1}`);

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
  campaignId: string,
  instanceId: string,
  input: UpdateMonsterInstanceInput,
) {
  const current = await fetchScopedInstanceOrThrow(pool, campaignId, instanceId);

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

  // REFACTOR-PLAN.md §2: the same system-wide "at most one living instance"
  // invariant createMonsterInstance enforces on spawn also has to hold on
  // update — otherwise flipping a dead unique instance's status back to
  // 'alive' (undo a mistaken kill, a homebrew "revive," etc.) is an
  // unguarded second door into the exact bug this phase fixes. Only runs
  // when the update actually targets 'alive' and the instance isn't already
  // alive (a no-op re-save of an already-living instance never needs the
  // check — it can't newly collide with itself).
  if (input.status === 'alive' && current.status !== 'alive') {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const monsterResult = await client.query<{ id: string; name: string; is_unique: boolean }>(
        `SELECT m.id, m.name, m.is_unique FROM monsters m
         JOIN monster_instances mi ON mi.monster_id = m.id
         WHERE mi.id = $1 FOR UPDATE OF m`,
        [instanceId],
      );
      const monster = monsterResult.rows[0];
      if (monster?.is_unique) {
        const uniqueLiving = await client.query<{ campaign_id: string; campaign_name: string }>(
          `SELECT mi.campaign_id, c.name AS campaign_name
           FROM monster_instances mi
           JOIN campaigns c ON c.id = mi.campaign_id
           WHERE mi.monster_id = $1 AND mi.status = 'alive' AND mi.id != $2
           LIMIT 1`,
          [monster.id, instanceId],
        );
        const existing = uniqueLiving.rows[0];
        if (existing) {
          throw new AppError(
            'CONFLICT',
            `${monster.name} is unique and already has a living instance in campaign "${existing.campaign_name}" (id ${existing.campaign_id})`,
            { existingCampaignId: existing.campaign_id },
          );
        }
      }

      values.push(instanceId);
      const result = await client.query(
        `UPDATE monster_instances SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
        values,
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

  values.push(instanceId);
  const result = await pool.query(`UPDATE monster_instances SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, values);
  return result.rows[0];
}

export async function deleteMonsterInstance(pool: Pool, campaignId: string, instanceId: string): Promise<void> {
  await fetchScopedInstanceOrThrow(pool, campaignId, instanceId);
  await pool.query(`DELETE FROM monster_instances WHERE id = $1`, [instanceId]);
}

// See characters.ts's applyHpDelta for why this returns an array of
// per-encounter sync targets rather than a single seq: a monster instance's
// combat_participants row is per-encounter, and its sync_seq bump happens in
// the SAME transaction as the HP update (PLAN.md §5.2).
export interface EncounterHpSyncTarget {
  encounter_id: string;
  campaign_id: string;
  sync_seq: number;
  participant_id: string;
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
  actorId: string,
  instanceId: string,
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
       RETURNING e.id AS encounter_id, e.campaign_id, e.sync_seq, cp.id AS participant_id`,
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

// REFACTOR-PLAN.md §6 / docs/rules/attacks-and-damage.md §2.3 — a sibling to
// applyMonsterInstanceHpDelta above (see services/characters.ts's
// applyDamage for the fuller rationale: this is the one that reads the
// monster's actual damage_resistances/vulnerabilities/immunities and rolls
// the damage dice server-side, rather than trusting a client-computed final
// delta that could simply skip a resistance).
export interface ApplyMonsterInstanceDamageResult {
  monsterInstance: Record<string, unknown>;
  encounterSyncs: EncounterHpSyncTarget[];
  diceRoll: { diceTotal: number; rolls: number[] };
  rawTotal: number;
  appliedDamage: number;
  // Phase 2 "concentration-broken save prompt" — see ApplyDamageResult's
  // sibling field (services/characters.ts) for the full rationale.
  concentrationCheck: { effectId: string; effectDefinitionId: string; effectName: string; dc: number } | null;
  breakdown: {
    diceTotal: number;
    modifier: number;
    resistanceApplied: boolean;
    vulnerabilityApplied: boolean;
    immune: boolean;
  };
}

// Phase 1 "players attack from their own UI": the target instance must
// actually be part of the attacker's encounter — authorizeAttackerOnTurn
// (services/encounters.ts) already confirmed control + turn order for the
// attacking participant itself, this just stops a crafted request from
// applying damage to an instance the attacker isn't actually facing. Returns
// the target's own combat_participants id (Phase 4 needs it for the pending
// request's target_participant_ids).
async function assertTargetInEncounter(pool: Pool, targetInstanceId: string, encounterId: string): Promise<string> {
  const targetRes = await pool.query<{ id: string }>(
    `SELECT id FROM combat_participants WHERE monster_instance_id = $1 AND encounter_id = $2`,
    [targetInstanceId, encounterId],
  );
  const row = targetRes.rows[0];
  if (!row) {
    throw new AppError('VALIDATION_ERROR', 'Target is not part of this encounter');
  }
  return row.id;
}

export async function applyMonsterInstanceDamage(
  pool: Pool,
  actorId: string,
  instanceId: string,
  input: ApplyDamageInput,
): Promise<ApplyMonsterInstanceDamageResult | PendingActionCreated> {
  const instance = await fetchInstanceOrThrow(pool, instanceId);
  const role = await requireMembership(pool, instance.campaign_id, actorId);

  // Phase 1 "players attack from their own UI": a non-DM caller must name the
  // combat_participants row they're attacking as (input.encounterId is
  // guaranteed present alongside it by applyDamageSchema's refine), so
  // authorizeAttackerOnTurn can verify they control that participant and
  // that it's currently their turn. Omit it and a non-DM caller is rejected
  // exactly as before — the DM keeps the original unconditional path.
  if (role !== 'dm') {
    if (!input.attackerParticipantId) requireDm(role);
    else {
      await authorizeAttackerOnTurn(pool, actorId, input.encounterId!, input.attackerParticipantId);
      const targetParticipantId = await assertTargetInEncounter(pool, instanceId, input.encounterId!);

      // Phase 4 "DM approval before a player-submitted action resolves":
      // control + turn order are already verified above — this is the point
      // where a DM caller would go on to roll and apply damage. A non-DM
      // caller instead stops here and queues the exact same input for the
      // DM to approve (routes/pendingActions.ts replays this same function
      // with the DM's own actorId, which always takes the role === 'dm'
      // branch below and skips this whole block).
      const request = await createPendingAction(pool, {
        encounterId: input.encounterId!,
        campaignId: instance.campaign_id,
        requestedByUserId: actorId,
        actorParticipantId: input.attackerParticipantId,
        targetParticipantIds: [targetParticipantId],
        kind: 'attack_monster',
        label: input.rollContext ?? 'Attack',
        payload: { instanceId, damage: input },
      });
      return { pending: true, request };
    }
  }

  // M3: re-derived from the actual stored roll, never trusted from
  // input.isCritical — see deriveIsCriticalFromAttackRoll's own comment.
  const isCritical = await deriveIsCriticalFromAttackRoll(pool, instance.campaign_id, input.attackRollId);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const locked = await client.query<{
      hp_current: number;
      hp_temp: number;
      hp_max: number;
      damage_resistances: string[] | null;
      damage_vulnerabilities: string[] | null;
      damage_immunities: string[] | null;
    }>(
      `SELECT mi.hp_current, mi.hp_temp, COALESCE(mi.hp_max_override, m.hit_point_average) AS hp_max,
              m.damage_resistances, m.damage_vulnerabilities, m.damage_immunities
       FROM monster_instances mi JOIN monsters m ON m.id = mi.monster_id
       WHERE mi.id = $1 FOR UPDATE OF mi`,
      [instanceId],
    );
    const row = locked.rows[0]!;

    const diceCount = criticalDiceCount(input.diceCount, isCritical);
    const rolls = Array.from({ length: diceCount }, () => rollDie(input.diceSides));
    const diceTotal = rolls.reduce((sum, r) => sum + r, 0);

    const applied = computeAppliedDamage(
      { rolledDiceTotal: diceTotal, modifier: input.modifier, damageType: input.damageType ?? null, isCritical },
      {
        resistances: row.damage_resistances ?? [],
        vulnerabilities: row.damage_vulnerabilities ?? [],
        immunities: row.damage_immunities ?? [],
      },
    );

    const { hpCurrent, hpTemp } = applyHpDeltaWithTempAbsorption(row, { delta: -applied.appliedDamage, tempDelta: 0 });

    // Phase 2 "HP/damage undo" — see services/characters.ts's applyDamage
    // sibling comment for the full rationale.
    const hpSnapshot = { hp_current: row.hp_current, hp_temp: row.hp_temp };

    const result = await client.query(
      `UPDATE monster_instances mi
       SET hp_current = $1, hp_temp = $2, last_hp_snapshot = $4::jsonb
       FROM monsters m
       WHERE mi.id = $3 AND m.id = mi.monster_id
       RETURNING mi.*, m.hit_point_average`,
      [hpCurrent, hpTemp, instanceId, JSON.stringify(hpSnapshot)],
    );

    const encounterSyncs = await client.query<EncounterHpSyncTarget>(
      `UPDATE encounters e
       SET sync_seq = sync_seq + 1
       FROM combat_participants cp
       WHERE cp.monster_instance_id = $1 AND cp.encounter_id = e.id
       RETURNING e.id AS encounter_id, e.campaign_id, e.sync_seq, cp.id AS participant_id`,
      [instanceId],
    );

    if (input.encounterId !== undefined) {
      await client.query(
        `INSERT INTO dice_rolls
           (campaign_id, user_id, monster_instance_id, encounter_id, roll_type, roll_context,
            d20_rolls, keep, dice_sides, dice_count, modifier, result_total, is_critical)
         VALUES ($1,$2,$3,$4,'damage',$5,$6,'normal',$7,$8,$9,$10,$11)`,
        [
          instance.campaign_id, actorId, instanceId, input.encounterId,
          input.rollContext ?? null, rolls, input.diceSides, diceCount, input.modifier, diceTotal + input.modifier,
          isCritical,
        ],
      );
    }

    const concentrationEffect =
      applied.appliedDamage > 0 ? await findActiveConcentrationEffect(client, { characterId: null, monsterInstanceId: instanceId }) : null;

    await client.query('COMMIT');
    return {
      monsterInstance: result.rows[0],
      encounterSyncs: encounterSyncs.rows,
      diceRoll: { diceTotal, rolls },
      rawTotal: applied.rawTotal,
      appliedDamage: applied.appliedDamage,
      breakdown: applied.breakdown,
      concentrationCheck: concentrationEffect
        ? {
            effectId: concentrationEffect.id,
            effectDefinitionId: concentrationEffect.effect_definition_id,
            effectName: concentrationEffect.name,
            dc: computeConcentrationDc(applied.appliedDamage),
          }
        : null,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export interface UndoLastMonsterInstanceDamageResult {
  monsterInstance: Record<string, unknown>;
  encounterSyncs: EncounterHpSyncTarget[];
}

// Phase 2 "HP/damage undo" — see services/characters.ts's undoLastDamage
// sibling for the full rationale. Every monster-instance mutation is
// already DM-only (requireDm below), so there's no "controller vs DM" split
// to preserve the way undoLastDamage has for characters.
export async function undoLastMonsterInstanceDamage(pool: Pool, actorId: string, instanceId: string): Promise<UndoLastMonsterInstanceDamageResult> {
  const instance = await fetchInstanceOrThrow(pool, instanceId);
  const role = await requireMembership(pool, instance.campaign_id, actorId);
  requireDm(role);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const locked = await client.query<{ last_hp_snapshot: { hp_current: number; hp_temp: number } | null }>(
      `SELECT last_hp_snapshot FROM monster_instances WHERE id = $1 FOR UPDATE`,
      [instanceId],
    );
    const snapshot = locked.rows[0]?.last_hp_snapshot;
    if (!snapshot) throw new AppError('CONFLICT', 'Nothing to undo for that monster instance');

    const result = await client.query(
      `UPDATE monster_instances mi
       SET hp_current = $1, hp_temp = $2, last_hp_snapshot = NULL
       FROM monsters m
       WHERE mi.id = $3 AND m.id = mi.monster_id
       RETURNING mi.*, m.hit_point_average`,
      [snapshot.hp_current, snapshot.hp_temp, instanceId],
    );

    const encounterSyncs = await client.query<EncounterHpSyncTarget>(
      `UPDATE encounters e
       SET sync_seq = sync_seq + 1
       FROM combat_participants cp
       WHERE cp.monster_instance_id = $1 AND cp.encounter_id = e.id
       RETURNING e.id AS encounter_id, e.campaign_id, e.sync_seq, cp.id AS participant_id`,
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

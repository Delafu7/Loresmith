// Plot threads (Phase 3) — a DM's running list of open story hooks, with
// staleness computed on read (never stored) so "this hasn't come up in a
// while" doesn't need a background job to stay accurate. Visibility is
// per-user via entity_visibility (Phase 1.3), not a plain boolean — a
// thread can be known to some players and not others (e.g. a secret tied
// to one PC's backstory).

import type { Pool } from 'pg';
import { notFound } from '../middleware/errors.js';
import { requireDm, type CampaignRole } from './authz.js';
import { resolveAllowlistVisibilityBatch } from './visibility.js';
import type { CreatePlotThreadInput, UpdatePlotThreadInput, SetPlotThreadVisibilityInput } from '../schemas/plotThreads.js';

const ENTITY_TYPE = 'plot_thread';

interface PlotThreadRow {
  id: string;
  campaign_id: string;
  title: string;
  description: string | null;
  status: 'open' | 'resolved';
  origin_session_id: string | null;
  last_touched_at: string;
  created_at: string;
}

// DM sees every thread, each annotated with which user ids can currently
// see it (so the DM's own UI can render the sharing picker); a player only
// ever gets the threads entity_visibility actually grants them, with no
// visibleToUserIds annotation (that's DM-only bookkeeping, not something a
// player needs or should see — it would list every OTHER player's access too).
export async function listPlotThreads(pool: Pool, campaignId: string, actorId: string, role: CampaignRole) {
  const result = await pool.query<PlotThreadRow>(
    `SELECT * FROM plot_threads WHERE campaign_id = $1 ORDER BY last_touched_at DESC`,
    [campaignId],
  );

  if (role === 'dm') {
    const ids = result.rows.map((r) => r.id);
    const visRes =
      ids.length > 0
        ? await pool.query<{ entity_id: string; user_id: string }>(
            `SELECT entity_id, user_id FROM entity_visibility WHERE entity_type = $1 AND entity_id = ANY($2::uuid[])`,
            [ENTITY_TYPE, ids],
          )
        : { rows: [] as Array<{ entity_id: string; user_id: string }> };
    const byThread = new Map<string, string[]>();
    for (const row of visRes.rows) {
      const list = byThread.get(row.entity_id) ?? [];
      list.push(row.user_id);
      byThread.set(row.entity_id, list);
    }
    return result.rows.map((thread) => ({ ...thread, visibleToUserIds: byThread.get(thread.id) ?? [] }));
  }

  const visibility = await resolveAllowlistVisibilityBatch(
    pool,
    ENTITY_TYPE,
    result.rows.map((r) => r.id),
    actorId,
    role,
    false, // hidden-until-granted default — a plot thread starts as DM-only planning
  );
  return result.rows.filter((thread) => visibility.get(thread.id) === true);
}

async function fetchThreadScoped(pool: Pool, campaignId: string, threadId: string): Promise<PlotThreadRow> {
  const result = await pool.query<PlotThreadRow>(`SELECT * FROM plot_threads WHERE id = $1 AND campaign_id = $2`, [threadId, campaignId]);
  const row = result.rows[0];
  if (!row) throw notFound('Plot thread');
  return row;
}

export async function createPlotThread(pool: Pool, campaignId: string, role: CampaignRole, input: CreatePlotThreadInput) {
  requireDm(role);
  const result = await pool.query<PlotThreadRow>(
    `INSERT INTO plot_threads (campaign_id, title, description, origin_session_id) VALUES ($1,$2,$3,$4) RETURNING *`,
    [campaignId, input.title, input.description ?? null, input.originSessionId ?? null],
  );
  return result.rows[0];
}

export async function updatePlotThread(
  pool: Pool,
  campaignId: string,
  threadId: string,
  role: CampaignRole,
  input: UpdatePlotThreadInput,
) {
  requireDm(role);
  await fetchThreadScoped(pool, campaignId, threadId);

  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (input.title !== undefined) { sets.push(`title = $${i++}`); values.push(input.title); }
  if (input.description !== undefined) { sets.push(`description = $${i++}`); values.push(input.description); }
  if (input.status !== undefined) { sets.push(`status = $${i++}`); values.push(input.status); }
  if (input.originSessionId !== undefined) { sets.push(`origin_session_id = $${i++}`); values.push(input.originSessionId); }

  // Any real edit counts as "touched" — bumped in the same statement as the
  // rest of the patch rather than a separate query.
  if (sets.length > 0) sets.push('last_touched_at = now()');
  if (sets.length === 0) return fetchThreadScoped(pool, campaignId, threadId);

  values.push(threadId);
  const result = await pool.query<PlotThreadRow>(`UPDATE plot_threads SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, values);
  return result.rows[0];
}

// "This came up again this session" without otherwise changing anything —
// a lighter-weight sibling to updatePlotThread for the common case of just
// clearing staleness.
export async function touchPlotThread(pool: Pool, campaignId: string, threadId: string, role: CampaignRole) {
  requireDm(role);
  await fetchThreadScoped(pool, campaignId, threadId);
  const result = await pool.query<PlotThreadRow>(
    `UPDATE plot_threads SET last_touched_at = now() WHERE id = $1 RETURNING *`,
    [threadId],
  );
  return result.rows[0];
}

export async function deletePlotThread(pool: Pool, campaignId: string, threadId: string, role: CampaignRole): Promise<void> {
  requireDm(role);
  await fetchThreadScoped(pool, campaignId, threadId);
  await pool.query(`DELETE FROM plot_threads WHERE id = $1`, [threadId]);
}

// Replaces the full set of users who can see this thread — simplest correct
// semantics for a DM-facing "who knows about this" checklist UI (diffing
// individual grants/revokes client-side would just reconstruct this same
// set anyway before submitting).
export async function setPlotThreadVisibility(
  pool: Pool,
  campaignId: string,
  threadId: string,
  role: CampaignRole,
  input: SetPlotThreadVisibilityInput,
): Promise<void> {
  requireDm(role);
  await fetchThreadScoped(pool, campaignId, threadId);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM entity_visibility WHERE entity_type = $1 AND entity_id = $2`, [ENTITY_TYPE, threadId]);
    for (const userId of input.userIds) {
      await client.query(
        `INSERT INTO entity_visibility (entity_type, entity_id, user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [ENTITY_TYPE, threadId, userId],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// GM-only visibility layer — one-click reveal/hide built on top of
// setPlotThreadVisibility above rather than a new visibility mechanism:
// plot threads already default to hidden-until-granted via entity_visibility
// (functionally 'gm_only' by default already, and strictly more granular
// than the notes/map-elements 3-state model), so these two are just
// convenience wrappers for the common "everyone" / "no one" cases.
export async function revealPlotThreadToAllPlayers(pool: Pool, campaignId: string, threadId: string, role: CampaignRole): Promise<void> {
  requireDm(role);
  const members = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM campaign_members WHERE campaign_id = $1 AND role = 'player'`,
    [campaignId],
  );
  await setPlotThreadVisibility(pool, campaignId, threadId, role, { userIds: members.rows.map((r) => r.user_id) });
}

export async function hidePlotThreadFromAllPlayers(pool: Pool, campaignId: string, threadId: string, role: CampaignRole): Promise<void> {
  await setPlotThreadVisibility(pool, campaignId, threadId, role, { userIds: [] });
}

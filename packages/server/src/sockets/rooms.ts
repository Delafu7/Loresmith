// Room topology (PLAN.md §5.1) + the join:campaign / join:encounter /
// request:sync handlers. Two tiers: campaign:{id} and encounter:{id}. Room
// membership is always re-derived from the DB on every join — a socket
// never joins a room because the client claimed a role, only because a
// server-side query just confirmed it (this is what makes reconnection safe
// per PLAN.md §5.5: "the server re-derives room membership from DB state,
// not client-claimed state").

import type { Server, Socket } from 'socket.io';
import { pool } from '../db/pool.js';
import { requireMembership, type CampaignRole } from '../services/authz.js';
import { AppError } from '../middleware/errors.js';
import { isUuid } from '../domain/ids.js';
import { buildFullStateSyncPayload } from './broadcast.js';
import { campaignRoom, encounterRoom } from './roomNames.js';
import type { SocketData } from './types.js';

type AckResponse = { ok: true; [key: string]: unknown } | { ok: false; error: { code: string; message: string } };
type Ack = (res: AckResponse) => void;

function errAck(err: unknown): AckResponse {
  if (err instanceof AppError) {
    return { ok: false, error: { code: err.code, message: err.message } };
  }
  const message = err instanceof Error ? err.message : 'Unknown error';
  return { ok: false, error: { code: 'INTERNAL', message } };
}

function userIdOf(socket: Socket): string {
  return (socket.data as SocketData).userId;
}

async function encounterContext(encounterId: string): Promise<{ campaignId: string; status: string }> {
  const result = await pool.query<{ campaign_id: string; status: string }>(
    `SELECT campaign_id, status FROM encounters WHERE id = $1`,
    [encounterId],
  );
  const row = result.rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'Encounter not found');
  return { campaignId: row.campaign_id, status: row.status };
}

/**
 * A player may join an encounter room only if the encounter is past
 * 'preparing' (nav point 1 — a still-configuring encounter is DM-only, full
 * stop, not just inert) AND they own a character that is a live
 * combat_participants row in that encounter. The DM may always join any
 * encounter in a campaign they DM. This is re-derived from the DB on every
 * join call — never cached, never trusted from a prior connection. Returns
 * the resolved role so callers don't need a second requireMembership call.
 * Exported for direct testing — this codebase has no socket-level test
 * harness (see damageAuthz.integration.test.ts's own note on that), but this
 * function itself has no socket/Express dependency, so it's testable as a
 * plain async function.
 */
export async function assertCanJoinEncounter(
  encounterId: string,
  campaignId: string,
  status: string,
  userId: string,
): Promise<CampaignRole> {
  const role = await requireMembership(pool, campaignId, userId);
  if (role === 'dm') return role;

  if (status === 'preparing') {
    throw new AppError('FORBIDDEN_NOT_OWNER', 'This encounter is still being prepared by the DM');
  }

  const result = await pool.query(
    `SELECT 1
     FROM combat_participants cp
     JOIN characters c ON c.id = cp.character_id
     WHERE cp.encounter_id = $1 AND c.owner_user_id = $2
     LIMIT 1`,
    [encounterId, userId],
  );
  if (result.rowCount === 0) {
    throw new AppError('FORBIDDEN_NOT_OWNER', 'You have no character in this encounter');
  }
  return role;
}

export function registerRoomHandlers(io: Server, socket: Socket): void {
  socket.on('join:campaign', async (payload: { campaignId?: string }, ack?: Ack) => {
    try {
      const campaignId = payload?.campaignId;
      if (!isUuid(campaignId)) {
        throw new AppError('VALIDATION_ERROR', 'campaignId must be a valid id');
      }
      const role = await requireMembership(pool, campaignId, userIdOf(socket));
      await socket.join(campaignRoom(campaignId));
      ack?.({ ok: true, role });
    } catch (err) {
      ack?.(errAck(err));
    }
  });

  socket.on('join:encounter', async (payload: { encounterId?: string }, ack?: Ack) => {
    try {
      const encounterId = payload?.encounterId;
      if (!isUuid(encounterId)) {
        throw new AppError('VALIDATION_ERROR', 'encounterId must be a valid id');
      }
      const { campaignId, status } = await encounterContext(encounterId);
      const role = await assertCanJoinEncounter(encounterId, campaignId, status, userIdOf(socket));

      await socket.join(encounterRoom(encounterId));
      ack?.({ ok: true });

      // Per PLAN.md §5.2, FULL_STATE_SYNC is "requested by a client after
      // join:encounter" — push it immediately so the client doesn't need a
      // second round-trip, without skipping the explicit request:sync path
      // below (used for later on-demand resyncs, e.g. after a seq gap).
      const syncPayload = await buildFullStateSyncPayload(pool, encounterId, campaignId, role, userIdOf(socket));
      socket.emit('FULL_STATE_SYNC', syncPayload);
    } catch (err) {
      ack?.(errAck(err));
    }
  });

  socket.on('request:sync', async (payload: { encounterId?: string }, ack?: Ack) => {
    try {
      const encounterId = payload?.encounterId;
      if (!isUuid(encounterId)) {
        throw new AppError('VALIDATION_ERROR', 'encounterId must be a valid id');
      }
      // Re-derive from the socket's actual joined rooms, not the client's
      // say-so — a client could ask to sync an encounter it never joined.
      if (!socket.rooms.has(encounterRoom(encounterId))) {
        throw new AppError('FORBIDDEN_ROLE', 'Not joined to this encounter room');
      }
      const { campaignId } = await encounterContext(encounterId);
      const role = await requireMembership(pool, campaignId, userIdOf(socket));
      const syncPayload = await buildFullStateSyncPayload(pool, encounterId, campaignId, role, userIdOf(socket));
      socket.emit('FULL_STATE_SYNC', syncPayload);
      ack?.({ ok: true });
    } catch (err) {
      ack?.(errAck(err));
    }
  });

  // GM-only visibility layer — "view as player" preview (DM-only). Forces
  // role='player', viewerId=null: a true "what does an anonymous player
  // see" snapshot, not "what does THIS DM see if downgraded to player" —
  // there's no natural "this DM's own player identity" to pass as
  // viewerId, and 'owner_only' content should render as a real player
  // would see it (nothing, since the DM has no 'owner_only' rows of their
  // own). Emits a distinctly-named event so it never collides with the
  // live FULL_STATE_SYNC the same socket also receives as the DM.
  socket.on('request:sync-preview', async (payload: { encounterId?: string }, ack?: Ack) => {
    try {
      const encounterId = payload?.encounterId;
      if (!isUuid(encounterId)) {
        throw new AppError('VALIDATION_ERROR', 'encounterId must be a valid id');
      }
      if (!socket.rooms.has(encounterRoom(encounterId))) {
        throw new AppError('FORBIDDEN_ROLE', 'Not joined to this encounter room');
      }
      const { campaignId } = await encounterContext(encounterId);
      const role = await requireMembership(pool, campaignId, userIdOf(socket));
      if (role !== 'dm') {
        throw new AppError('FORBIDDEN_ROLE', 'Only the DM can preview the player view');
      }
      const syncPayload = await buildFullStateSyncPayload(pool, encounterId, campaignId, 'player', null);
      socket.emit('FULL_STATE_SYNC_PREVIEW', syncPayload);
      ack?.({ ok: true });
    } catch (err) {
      ack?.(errAck(err));
    }
  });
}

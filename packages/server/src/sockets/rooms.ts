// Room topology (PLAN.md §5.1) + the join:campaign / join:encounter /
// request:sync handlers. Two tiers: campaign:{id} and encounter:{id}. Room
// membership is always re-derived from the DB on every join — a socket
// never joins a room because the client claimed a role, only because a
// server-side query just confirmed it (this is what makes reconnection safe
// per PLAN.md §5.5: "the server re-derives room membership from DB state,
// not client-claimed state").

import type { Server, Socket } from 'socket.io';
import { pool } from '../db/pool.js';
import { requireMembership } from '../services/authz.js';
import { AppError } from '../middleware/errors.js';
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

function userIdOf(socket: Socket): number {
  return (socket.data as SocketData).userId;
}

async function encounterCampaignId(encounterId: number): Promise<number> {
  const result = await pool.query<{ campaign_id: number }>(
    `SELECT campaign_id FROM encounters WHERE id = $1`,
    [encounterId],
  );
  const row = result.rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'Encounter not found');
  return row.campaign_id;
}

/**
 * A player may join an encounter room only if they own a character that is a
 * live combat_participants row in that encounter. The DM may always join any
 * encounter in a campaign they DM. This is re-derived from the DB on every
 * join call — never cached, never trusted from a prior connection.
 */
async function assertCanJoinEncounter(encounterId: number, campaignId: number, userId: number): Promise<void> {
  const role = await requireMembership(pool, campaignId, userId);
  if (role === 'dm') return;

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
}

export function registerRoomHandlers(io: Server, socket: Socket): void {
  socket.on('join:campaign', async (payload: { campaignId?: number }, ack?: Ack) => {
    try {
      const campaignId = Number(payload?.campaignId);
      if (!Number.isInteger(campaignId)) {
        throw new AppError('VALIDATION_ERROR', 'campaignId must be an integer');
      }
      const role = await requireMembership(pool, campaignId, userIdOf(socket));
      await socket.join(campaignRoom(campaignId));
      ack?.({ ok: true, role });
    } catch (err) {
      ack?.(errAck(err));
    }
  });

  socket.on('join:encounter', async (payload: { encounterId?: number }, ack?: Ack) => {
    try {
      const encounterId = Number(payload?.encounterId);
      if (!Number.isInteger(encounterId)) {
        throw new AppError('VALIDATION_ERROR', 'encounterId must be an integer');
      }
      const campaignId = await encounterCampaignId(encounterId);
      await assertCanJoinEncounter(encounterId, campaignId, userIdOf(socket));

      await socket.join(encounterRoom(encounterId));
      ack?.({ ok: true });

      // Per PLAN.md §5.2, FULL_STATE_SYNC is "requested by a client after
      // join:encounter" — push it immediately so the client doesn't need a
      // second round-trip, without skipping the explicit request:sync path
      // below (used for later on-demand resyncs, e.g. after a seq gap).
      await requireMembership(pool, campaignId, userIdOf(socket));
      const syncPayload = await buildFullStateSyncPayload(pool, encounterId, campaignId);
      socket.emit('FULL_STATE_SYNC', syncPayload);
    } catch (err) {
      ack?.(errAck(err));
    }
  });

  socket.on('request:sync', async (payload: { encounterId?: number }, ack?: Ack) => {
    try {
      const encounterId = Number(payload?.encounterId);
      if (!Number.isInteger(encounterId)) {
        throw new AppError('VALIDATION_ERROR', 'encounterId must be an integer');
      }
      // Re-derive from the socket's actual joined rooms, not the client's
      // say-so — a client could ask to sync an encounter it never joined.
      if (!socket.rooms.has(encounterRoom(encounterId))) {
        throw new AppError('FORBIDDEN_ROLE', 'Not joined to this encounter room');
      }
      const campaignId = await encounterCampaignId(encounterId);
      await requireMembership(pool, campaignId, userIdOf(socket));
      const syncPayload = await buildFullStateSyncPayload(pool, encounterId, campaignId);
      socket.emit('FULL_STATE_SYNC', syncPayload);
      ack?.({ ok: true });
    } catch (err) {
      ack?.(errAck(err));
    }
  });
}

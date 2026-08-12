// Emit helpers for the combat event protocol (PLAN.md §5.2, Phase 1 subset).
// Route handlers call these with a single, thin function call right after
// their service mutation commits — no DB writes happen in this file except
// the read-only queries needed to compute who's in a room and what role they
// hold; the mutation itself always already happened in the route/service.
//
// Naming choice: PLAN.md's table lists DAMAGE_APPLIED / HEAL_APPLIED as two
// events, but both the character and monster-instance HP endpoints are a
// single signed-delta function — there is no separate "heal" code path to
// hang a second event name off of, and a delta of 0 is valid input. This
// implementation emits ONE event, `HP_CHANGED`, carrying a `changeType`
// field ('damage' | 'heal' | 'none') derived from the sign of the delta, so
// a client that wants DAMAGE_APPLIED/HEAL_APPLIED-shaped behavior can still
// branch on that field. Documented here per the task brief's "just document
// your naming choice."

import type { Server } from 'socket.io';
import type { Application } from 'express';
import type { Pool, PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import { campaignRoom, encounterRoom } from './roomNames.js';
import type { SocketData } from './types.js';
import { getEncounterCombatSnapshot, getEncounterMap, formatMapForWire } from '../services/encounters.js';
import type { EncounterMapRow } from '../services/encounters.js';
import { listMapElements, formatMapElementForWire } from '../services/mapElements.js';
import type { CampaignRole } from '../services/authz.js';
import { isActionVisibleToPlayers, type CombatActionView } from '../services/combatActions.js';
import { isRollVisibleToViewer } from '../services/diceRolls.js';
import { resolveVisibilitySync } from '../services/visibility.js';
import { bandHp, type HpBand } from '../domain/hpBanding.js';

export function getIo(app: Application): Server {
  const io = app.get('io') as Server | undefined;
  if (!io) throw new Error('Socket.io server not attached to the Express app (app.set("io", ...) never ran)');
  return io;
}

interface EncounterLike {
  id: string;
  campaign_id: string;
  sync_seq: number;
  status?: string;
  current_round?: number;
  current_turn_index?: number;
  [key: string]: unknown;
}

function envelope(encounter: EncounterLike) {
  return {
    encounterId: encounter.id,
    campaignId: encounter.campaign_id,
    seq: encounter.sync_seq,
    serverTimestamp: Date.now(),
  };
}

// ---- Role-split plumbing for HP_CHANGED / FULL_STATE_SYNC ----
//
// Per PLAN.md §5.2's "key rule": compute two payloads server-side and emit
// twice, never one payload with a client-side redaction flag. This looks up
// each currently-connected room member's role fresh from campaign_members —
// it does not trust any cached role on the socket, since a user's role is a
// DB fact, not a connection-time fact.

async function splitSocketsByRole(
  io: Server,
  campaignId: string,
  room: string,
): Promise<{ dmSocketIds: string[]; playerSocketIds: string[] }> {
  const socketsInRoom = await io.in(room).fetchSockets();
  if (socketsInRoom.length === 0) return { dmSocketIds: [], playerSocketIds: [] };

  const userIds = [...new Set(socketsInRoom.map((s) => (s.data as SocketData).userId))];
  const roleRes = await pool.query<{ user_id: string; role: CampaignRole }>(
    `SELECT user_id, role FROM campaign_members WHERE campaign_id = $1 AND user_id = ANY($2::uuid[])`,
    [campaignId, userIds],
  );
  const roleByUser = new Map(roleRes.rows.map((r) => [r.user_id, r.role]));

  const dmSocketIds: string[] = [];
  const playerSocketIds: string[] = [];
  for (const s of socketsInRoom) {
    const role = roleByUser.get((s.data as SocketData).userId);
    (role === 'dm' ? dmSocketIds : playerSocketIds).push(s.id);
  }
  return { dmSocketIds, playerSocketIds };
}

// Security major M2 — buildFullStateSyncPayload/broadcastFullStateResync
// correctly filter out a hidden (visible_to_players = false) participant,
// but every OTHER per-participant broadcast below used to be a plain
// room-wide emit with no such check, so an ambush's position/HP/effects/AC/
// action-economy/faction leaked to player sockets in real time even though
// the participant row itself was correctly withheld from FULL_STATE_SYNC.
// This also caused a real staleness bug: an effect applied to a hidden
// participant was dropped client-side (no matching participant row to
// attach it to) and never appeared once the participant was revealed,
// because the original EFFECT_APPLIED never reached the player at all.
//
// Two lookups below (by participant id, and by encounter+target for the
// effect events which don't carry a participant id) rather than one shared
// shape, since the two callers have different data on hand.
export async function isParticipantIdVisibleToPlayers(poolOrClient: Pool | PoolClient, participantId: string): Promise<boolean> {
  const res = await poolOrClient.query<{ visible_to_players: boolean }>(
    `SELECT visible_to_players FROM combat_participants WHERE id = $1`,
    [participantId],
  );
  // Missing row (already removed) defaults to visible — never the wrong
  // direction to fail in, since the alternative silently hides a legitimate
  // event with no participant left to reveal it later.
  return res.rows[0]?.visible_to_players !== false;
}

export async function isEncounterTargetVisibleToPlayers(
  poolOrClient: Pool | PoolClient,
  encounterId: string,
  characterId: string | null,
  monsterInstanceId: string | null,
): Promise<boolean> {
  if (characterId == null && monsterInstanceId == null) return true;
  const res = await poolOrClient.query<{ visible_to_players: boolean }>(
    `SELECT visible_to_players FROM combat_participants
     WHERE encounter_id = $1 AND (character_id = $2 OR monster_instance_id = $3)
     LIMIT 1`,
    [encounterId, characterId, monsterInstanceId],
  );
  // No matching participant row (e.g. an outside-combat effect on a
  // character that isn't currently seated anywhere) — nothing to hide.
  return res.rows[0]?.visible_to_players !== false;
}

// Splits room sockets by role and emits the SAME payload to both — the DM
// side is unconditional, the player side is skipped entirely when
// `visibleToPlayers` is false. Every event in this file that targets a
// specific combat participant (as opposed to encounter-wide state like
// MAP_UPDATED/MODE_CHANGED, which was never participant-hidden info) routes
// through this rather than a bare `io.to(room).emit(...)`.
async function emitToEncounterRespectingVisibility(
  io: Server,
  campaignId: string,
  encounterId: string,
  event: string,
  payload: Record<string, unknown>,
  visibleToPlayers: boolean,
): Promise<void> {
  const { dmSocketIds, playerSocketIds } = await splitSocketsByRole(io, campaignId, encounterRoom(encounterId));
  if (dmSocketIds.length > 0) io.to(dmSocketIds).emit(event, payload);
  // 'role_split' mode (services/visibility.ts, Phase 1.1).
  if (resolveVisibilitySync({ mode: 'role_split', visibleToPlayers }, null, 'player') && playerSocketIds.length > 0) {
    io.to(playerSocketIds).emit(event, payload);
  }
}

// ---- Events with no visibility split (identical payload for DM + players) ----

export function broadcastCombatStarted(io: Server, encounter: EncounterLike): void {
  io.to(encounterRoom(encounter.id)).emit('COMBAT_STARTED', {
    ...envelope(encounter),
    status: encounter.status,
    currentRound: encounter.current_round,
  });
}

export function broadcastCombatEnded(io: Server, encounter: EncounterLike): void {
  const room = encounterRoom(encounter.id);
  io.to(room).emit('COMBAT_ENDED', { ...envelope(encounter), status: encounter.status });
  // "clients removed from encounter:{id} server-side after" (PLAN.md §5.2) —
  // don't leave stale player sockets subscribed to a room whose combat is over.
  void io.in(room).socketsLeave(room);
}

// M2: rolling initiative for the whole encounter can include a hidden
// (ambush) participant — that participant's row (and thus its position in
// the turn order) must not reach player sockets. Two payloads, same
// "compute per-role server-side" discipline as buildFullStateSyncPayload,
// rather than the single shared payload this used to be.
export async function broadcastInitiativeRolled(
  io: Server,
  encounter: EncounterLike,
  participants: Array<{ id: string; initiative_roll: number; initiative_tiebreak: number | null; turn_order: number; visible_to_players?: boolean }>,
): Promise<void> {
  const { dmSocketIds, playerSocketIds } = await splitSocketsByRole(io, encounter.campaign_id, encounterRoom(encounter.id));
  const toWire = (list: typeof participants) => ({
    ...envelope(encounter),
    // no HP in payload, per PLAN.md §5.2
    participants: list.map((p) => ({
      participantId: p.id,
      initiativeRoll: p.initiative_roll,
      initiativeTiebreak: p.initiative_tiebreak,
      turnOrder: p.turn_order,
    })),
  });

  if (dmSocketIds.length > 0) io.to(dmSocketIds).emit('INITIATIVE_ROLLED', toWire(participants));
  if (playerSocketIds.length > 0) {
    // 'role_split' mode (services/visibility.ts, Phase 1.1) — this used to
    // hand-roll its own copy of the visible_to_players !== false check.
    const visible = participants.filter((p) => resolveVisibilitySync({ mode: 'role_split', visibleToPlayers: p.visible_to_players }, null, 'player'));
    io.to(playerSocketIds).emit('INITIATIVE_ROLLED', toWire(visible));
  }
}

export function broadcastTurnAdvanced(
  io: Server,
  encounter: EncounterLike,
  participants: Array<{ id: string; turn_order: number }>,
): void {
  const active = participants.find((p) => p.turn_order === encounter.current_turn_index);
  io.to(encounterRoom(encounter.id)).emit('TURN_ADVANCED', {
    ...envelope(encounter),
    currentRound: encounter.current_round,
    currentTurnIndex: encounter.current_turn_index,
    activeParticipantId: active?.id ?? null,
  });
}

// Phase 2 "lair actions (round-start trigger)" — plain room-wide broadcast,
// no DM/player split, same "not sensitive info" precedent as MAP_UPDATED/
// TOKEN_MOVED: a lair action is a narratively-visible event at the table,
// not secret DM state. Only fired by the advance-turn route when the round
// actually just advanced AND the encounter has lair actions configured —
// see AdvanceTurnResult's roundAdvanced comment.
export function broadcastLairActionAvailable(io: Server, encounter: EncounterLike): void {
  io.to(encounterRoom(encounter.id)).emit('LAIR_ACTION_AVAILABLE', {
    ...envelope(encounter),
    currentRound: encounter.current_round,
    lairActions: encounter.lair_actions,
  });
}

// M2: gated the same as every other per-participant event even though
// today's addParticipant/spawn schemas always create a row visible=true (no
// create-time hidden option exists yet) — structural consistency so a
// future hidden-at-spawn capability can't reintroduce this leak by having to
// remember to add the check here.
export async function broadcastParticipantJoined(
  io: Server,
  encounter: EncounterLike,
  participant: { id: string; character_id: string | null; monster_instance_id: string | null; initiative_roll: number; turn_order: number; visible_to_players?: boolean },
): Promise<void> {
  await emitToEncounterRespectingVisibility(
    io,
    encounter.campaign_id,
    encounter.id,
    'PARTICIPANT_JOINED',
    {
      ...envelope(encounter),
      participant: {
        participantId: participant.id,
        characterId: participant.character_id,
        monsterInstanceId: participant.monster_instance_id,
        initiativeRoll: participant.initiative_roll,
        turnOrder: participant.turn_order,
      },
    },
    participant.visible_to_players !== false,
  );
}

/**
 * If the newly-added participant is a player-owned PC, that player's
 * already-connected sockets (in campaign:{id} but not yet in
 * encounter:{id}) are auto-joined server-side and immediately sent a
 * FULL_STATE_SYNC — per PLAN.md §5.2's note that PARTICIPANT_JOINED
 * "triggers a room-join push if it's a player's own PC." Room membership is
 * still being derived from a DB fact (the combat_participants row that was
 * just inserted), not client say-so.
 */
export async function pushEncounterRoomJoinForOwner(
  io: Server,
  pool_: Pool,
  encounterId: string,
  campaignId: string,
  characterId: string | null,
): Promise<void> {
  if (characterId === null) return;
  const ownerRes = await pool_.query<{ owner_user_id: string | null }>(
    `SELECT owner_user_id FROM characters WHERE id = $1`,
    [characterId],
  );
  const ownerUserId = ownerRes.rows[0]?.owner_user_id;
  if (ownerUserId == null) return;

  const room = encounterRoom(encounterId);
  const campaignSockets = await io.in(campaignRoom(campaignId)).fetchSockets();
  const targets = campaignSockets.filter(
    (s) => (s.data as SocketData).userId === ownerUserId && !s.rooms.has(room),
  );
  if (targets.length === 0) return;

  await Promise.all(targets.map((s) => s.join(room)));
  // Always a player: this function only ever auto-joins the OWNING player's
  // sockets for their own new PC (see this function's own header comment).
  const syncPayload = await buildFullStateSyncPayload(pool_, encounterId, campaignId, 'player');
  for (const s of targets) s.emit('FULL_STATE_SYNC', syncPayload);
}

export function broadcastParticipantLeft(
  io: Server,
  encounter: EncounterLike,
  participant: { id: string; character_id: string | null; monster_instance_id: string | null },
): void {
  io.to(encounterRoom(encounter.id)).emit('PARTICIPANT_LEFT', {
    ...envelope(encounter),
    participant: {
      participantId: participant.id,
      characterId: participant.character_id,
      monsterInstanceId: participant.monster_instance_id,
    },
  });
}

// ---- MAP_UPDATED / TOKEN_MOVED (Phase 3.3) ----
//
// Neither event needs a DM/player visibility split, unlike HP_CHANGED — map
// config and token position aren't HP-sensitive info, so both are plain
// room-wide broadcasts.

export function broadcastMapUpdated(io: Server, encounter: EncounterLike, map: EncounterMapRow): void {
  io.to(encounterRoom(encounter.id)).emit('MAP_UPDATED', {
    ...envelope(encounter),
    id: map.id,
    backgroundAssetId: map.background_asset_id,
    backgroundFileUrl: map.background_file_url,
    gridColumns: map.grid_columns,
    gridRows: map.grid_rows,
    cellSizePx: map.cell_size_px,
    feetPerCell: map.feet_per_cell,
  });
}

// M2: position is exactly the kind of thing an ambush needs hidden — a
// player's client silently rendering a moving token for a participant that
// was never supposed to appear in their roster defeats the whole point of
// visible_to_players. Looked up fresh by participant id since the callers
// (movement/teleport routes) don't already have the flag on hand.
export async function broadcastTokenMoved(
  io: Server,
  encounter: EncounterLike,
  participant: { id: string; pos_x: number | null; pos_y: number | null },
): Promise<void> {
  const visible = await isParticipantIdVisibleToPlayers(pool, participant.id);
  await emitToEncounterRespectingVisibility(
    io,
    encounter.campaign_id,
    encounter.id,
    'TOKEN_MOVED',
    { ...envelope(encounter), participantId: participant.id, x: participant.pos_x, y: participant.pos_y },
    visible,
  );
}

// ---- MAP_ELEMENTS_CHANGED (DM battle-map vision/elements feature) ----
//
// Elements are scoped to maps.id, not a single encounter (see
// services/mapElements.ts's header comment) — every encounter currently
// linked to the affected map gets its own broadcast, each carrying that
// encounter's own freshly-bumped sync_seq (same "envelope reflects real
// per-encounter state" discipline as every other event here). No DM/player
// split, same reasoning as MAP_UPDATED/TOKEN_MOVED (not HP-sensitive info) —
// the one exception is 'note' elements, which the CLIENT never renders to a
// non-DM viewer regardless of visibleToPlayers (see the web registry's note
// entry); that's a display-layer rule, not a wire-payload redaction.
export function broadcastMapElementsChanged(
  io: Server,
  affectedEncounters: { id: string; campaign_id: string; sync_seq: number }[],
  changeType: 'created' | 'updated' | 'deleted',
  // 'deleted' has no row left to format — callers pass just the id in that case.
  element: ReturnType<typeof formatMapElementForWire> | { id: string },
): void {
  for (const encounter of affectedEncounters) {
    io.to(encounterRoom(encounter.id)).emit('MAP_ELEMENTS_CHANGED', {
      ...envelope(encounter),
      changeType,
      element,
    });
  }
}

// Exploration/combat mode toggle — the one genuinely new realtime event this
// feature needs; token moves themselves keep reusing TOKEN_MOVED/
// FULL_STATE_SYNC unchanged, just carrying `mode` in their encounter
// envelope now (see buildFullStateSyncPayload below). No visibility split,
// same reasoning as MAP_UPDATED/TOKEN_MOVED — mode isn't sensitive info.
export function broadcastModeChanged(io: Server, encounter: EncounterLike & { mode: 'exploration' | 'combat' }): void {
  io.to(encounterRoom(encounter.id)).emit('MODE_CHANGED', {
    ...envelope(encounter),
    mode: encounter.mode,
  });
}

// Encounter-level disposition transition (distinct from
// PARTICIPANT_FACTION_CHANGED below — this is "is the scene a fight",
// not "which side is a participant on"). Carries the full event row so
// clients can append to a disposition history list without a follow-up
// fetch, same reasoning as ACTION_RECORDED below.
export function broadcastDispositionChanged(
  io: Server,
  encounter: EncounterLike & { disposition: 'friendly' | 'neutral' | 'hostile' | 'unknown' },
  event: { id: string; fromDisposition: string; toDisposition: string; changedByUserId: string; note: string | null; createdAt: string },
): void {
  io.to(encounterRoom(encounter.id)).emit('DISPOSITION_CHANGED', {
    ...envelope(encounter),
    disposition: encounter.disposition,
    event,
  });
}

// REFACTOR-PLAN.md §3 — same no-visibility-split shape as TOKEN_MOVED above
// (faction isn't HP-sensitive info).
// M2: a hidden ambusher's faction (e.g. flipped from 'neutral' to 'enemy'
// right before the DM reveals it) must not tip a player off before the
// reveal itself does.
export async function broadcastParticipantFactionChanged(
  io: Server,
  encounter: EncounterLike,
  participant: { id: string; faction: 'player' | 'ally' | 'enemy' | 'neutral' },
): Promise<void> {
  const visible = await isParticipantIdVisibleToPlayers(pool, participant.id);
  await emitToEncounterRespectingVisibility(
    io,
    encounter.campaign_id,
    encounter.id,
    'PARTICIPANT_FACTION_CHANGED',
    { ...envelope(encounter), participantId: participant.id, faction: participant.faction },
    visible,
  );
}

// ---- ACTION_ECONOMY_CHANGED (Phase 3.6) ----
//
// Same "no DM/player visibility split" reasoning as MAP_UPDATED/TOKEN_MOVED
// just above — whether a participant has spent their action this turn isn't
// HP-sensitive info, so this is a plain room-wide broadcast too.
// M2: whether a hidden participant has spent its action/bonus/reaction this
// turn is exactly the kind of tell an ambush must not leak before the DM
// reveals it.
export async function broadcastActionEconomyChanged(
  io: Server,
  encounter: EncounterLike,
  participant: {
    id: string;
    action_used: boolean;
    bonus_action_used: boolean;
    reaction_used: boolean;
    dash_used: boolean;
    movement_used_ft: number;
    object_interaction_used: boolean;
  },
): Promise<void> {
  const visible = await isParticipantIdVisibleToPlayers(pool, participant.id);
  await emitToEncounterRespectingVisibility(
    io,
    encounter.campaign_id,
    encounter.id,
    'ACTION_ECONOMY_CHANGED',
    {
      ...envelope(encounter),
      participantId: participant.id,
      actionUsed: participant.action_used,
      bonusActionUsed: participant.bonus_action_used,
      reactionUsed: participant.reaction_used,
      dashUsed: participant.dash_used,
      movementUsedFt: participant.movement_used_ft,
      objectInteractionUsed: participant.object_interaction_used,
    },
    visible,
  );
}

// ---- PARTICIPANT_AC_CHANGED (Phase 3.5) ----
//
// Naming choice: per PLAN.md §5.7, AC changes get no new broadcast in the
// common case, *except* when the character is currently a live
// combat_participants row, in which case the combat tracker's participant
// row needs to stay live. `PARTICIPANT_AC_CHANGED` names that one case
// directly, rather than overloading HP_CHANGED (a different stat, no shared
// payload shape) or MAP_UPDATED/TOKEN_MOVED (different subject entirely).
// AC isn't HP-sensitive info — nothing in this app's authorization model
// treats a creature's Armor Class as something a DM would want hidden from
// players (same reasoning as MAP_UPDATED/TOKEN_MOVED just above) — so, like
// those two, this is a single plain room-wide emit with no dmSocketIds/
// playerSocketIds split, unlike HP_CHANGED/EFFECT_APPLIED below. Characters
// only, per services/armorClass.ts's scope: monster_instance
// armor_class_override changes never call this (the existing monster-
// instance PATCH endpoint doesn't broadcast anything today either).
export interface ArmorClassSyncTarget {
  encounter_id: string;
  campaign_id: string;
  sync_seq: number;
}

// M2: an ambusher's AC recompute (e.g. its controlling player toggling
// auto-AC on their delegated PC) must not leak before the DM reveals it —
// same reasoning as every other per-participant event in this file, AC's
// own "not sensitive info" framing above only ever applied to a VISIBLE
// participant's AC.
export async function broadcastArmorClassChanged(
  io: Server,
  sync: ArmorClassSyncTarget,
  participant: { participantId: string; characterId: string; armorClass: number },
): Promise<void> {
  const visible = await isParticipantIdVisibleToPlayers(pool, participant.participantId);
  await emitToEncounterRespectingVisibility(
    io,
    sync.campaign_id,
    sync.encounter_id,
    'PARTICIPANT_AC_CHANGED',
    {
      encounterId: sync.encounter_id,
      campaignId: sync.campaign_id,
      seq: sync.sync_seq,
      serverTimestamp: Date.now(),
      participantId: participant.participantId,
      characterId: participant.characterId,
      armorClass: participant.armorClass,
    },
    visible,
  );
}

// ---- HP_CHANGED ----
//
// M2: a currently-hidden (visible_to_players = false) participant's HP must
// still not reach a player socket, same as every other per-participant
// event in this file. Phase 2 added a second, field-level split on top of
// that row-level one: even for a VISIBLE participant, hp_visibility decides
// whether a player gets exact numbers, a computed band, or nothing — see
// resolveHpForViewer above buildFullStateSyncPayload. Unlike most events in
// this file, this can't reuse emitToEncounterRespectingVisibility's
// "same payload, DM unconditional / player conditional" shape, since the DM
// and player payloads now genuinely differ in CONTENT, not just presence —
// same reason broadcastInitiativeRolled computes two payloads instead of one.

export interface HpChangeTarget {
  encounterId: string;
  campaignId: string;
  seq: number;
  participantId: string;
  characterId: string | null;
  monsterInstanceId: string | null;
  hpCurrent: number;
  hpMax: number;
  hpTemp: number;
  delta: number;
}

async function fetchParticipantVisibilityAndHpVisibility(
  poolOrClient: Pool | PoolClient,
  participantId: string,
): Promise<{ visibleToPlayers: boolean; hpVisibility: 'exact' | 'banded' | 'hidden' }> {
  const res = await poolOrClient.query<{ visible_to_players: boolean; hp_visibility: 'exact' | 'banded' | 'hidden' }>(
    `SELECT visible_to_players, hp_visibility FROM combat_participants WHERE id = $1`,
    [participantId],
  );
  const row = res.rows[0];
  // Missing row (already removed) defaults to visible/banded — never the
  // wrong direction to fail in, matching isParticipantIdVisibleToPlayers.
  return { visibleToPlayers: row?.visible_to_players !== false, hpVisibility: row?.hp_visibility ?? 'banded' };
}

export async function broadcastHpChanged(io: Server, target: HpChangeTarget): Promise<void> {
  const { visibleToPlayers, hpVisibility } = await fetchParticipantVisibilityAndHpVisibility(pool, target.participantId);
  const hpFields = { hpCurrent: target.hpCurrent, hpMax: target.hpMax, hpTemp: target.hpTemp, hpVisibility };
  const basePayload = {
    encounterId: target.encounterId,
    campaignId: target.campaignId,
    seq: target.seq,
    serverTimestamp: Date.now(),
    participantId: target.participantId,
    characterId: target.characterId,
    monsterInstanceId: target.monsterInstanceId,
    changeType: target.delta > 0 ? ('heal' as const) : target.delta < 0 ? ('damage' as const) : ('none' as const),
  };

  const isCharacter = target.characterId != null;
  const { dmSocketIds, playerSocketIds } = await splitSocketsByRole(io, target.campaignId, encounterRoom(target.encounterId));
  if (dmSocketIds.length > 0) {
    io.to(dmSocketIds).emit('HP_CHANGED', { ...basePayload, hp: resolveHpForViewer(hpFields, 'dm', isCharacter) });
  }
  if (visibleToPlayers && playerSocketIds.length > 0) {
    io.to(playerSocketIds).emit('HP_CHANGED', { ...basePayload, hp: resolveHpForViewer(hpFields, 'player', isCharacter) });
  }
}

// ---- REVEAL_CHANGED ----
//
// The only surviving DM/player redaction split: a monster instance's
// damage vulnerabilities/resistances/immunities can be individually
// hidden/revealed (see domain/revealFields.ts). One event per field per
// PATCH — a single reveals request can touch several fields, and per-field
// events keep this reusable for a future single-field toggle with no second
// payload shape. DM sockets always get the true value; player sockets get
// it only when revealed=true, with playerOverride substituted in when the
// DM set one — never a client-side flag, same discipline as HP_CHANGED.

export interface RevealChangeTarget {
  encounterId: string;
  campaignId: string;
  seq: number;
  participantId: string;
  monsterInstanceId: string;
  fieldKey: string;
  revealed: boolean;
  playerOverride: string | null;
  trueValue: unknown;
}

export async function broadcastRevealChanged(io: Server, target: RevealChangeTarget): Promise<void> {
  const { dmSocketIds, playerSocketIds } = await splitSocketsByRole(io, target.campaignId, encounterRoom(target.encounterId));

  const base = {
    encounterId: target.encounterId,
    campaignId: target.campaignId,
    seq: target.seq,
    serverTimestamp: Date.now(),
    participantId: target.participantId,
    monsterInstanceId: target.monsterInstanceId,
    fieldKey: target.fieldKey,
    revealed: target.revealed,
  };

  if (dmSocketIds.length > 0) {
    io.to(dmSocketIds).emit('REVEAL_CHANGED', { ...base, value: target.trueValue });
  }
  if (playerSocketIds.length > 0) {
    const value = target.revealed ? (target.playerOverride ?? target.trueValue) : null;
    io.to(playerSocketIds).emit('REVEAL_CHANGED', { ...base, value });
  }
}

// ---- EFFECT_APPLIED / EFFECT_EXPIRED ----
//
// Hooked into services/effects.ts the same way HP_CHANGED is hooked into the
// HP-delta routes: routes/*.ts calls one of these two thin functions once
// per `EncounterEffectSyncTarget` returned by the service (there can be more
// than one — see services/effects.ts's resolveEncounterSyncs — when an
// effect is applied/removed via the outside-combat character/monster-
// instance endpoints while that target happens to be a live participant in
// one or more encounters). Always a plain room-wide broadcast — the
// DM-only-hidden-effect option (`active_effects.visible_to_players`) was
// removed along with the rest of the hide/reveal feature.
//
// Batching choice for automatic round-based expiry (services/encounters.ts's
// advanceTurn can expire several 'rounds' effects on one turn advance): ONE
// EFFECT_EXPIRED event PER expired effect, not a single batched event with an
// array, so this reuses the exact same function for both the manual
// DELETE /effects/:id path and the automatic per-round decrement path with
// no second payload shape to maintain.

export interface EffectSyncTarget {
  encounter_id: string;
  campaign_id: string;
  sync_seq: number;
}

export interface EffectBroadcastRow {
  id: string;
  character_id: string | null;
  monster_instance_id: string | null;
  effect_definition_id: string;
  duration_type: string;
  duration_value: number | null;
  concentration: boolean;
  source_character_id: string | null;
}

function effectPayloadBase(sync: EffectSyncTarget, effect: EffectBroadcastRow, name: string) {
  return {
    encounterId: sync.encounter_id,
    campaignId: sync.campaign_id,
    seq: sync.sync_seq,
    serverTimestamp: Date.now(),
    effectId: effect.id,
    targetId: effect.character_id ?? effect.monster_instance_id,
    targetType: effect.character_id != null ? 'character' : 'monster_instance',
    effectDefinitionId: effect.effect_definition_id,
    name,
    durationType: effect.duration_type,
    durationRemaining: effect.duration_value,
    concentration: effect.concentration,
    sourceCharacterId: effect.source_character_id,
  };
}

// M2: this was the concrete staleness bug the audit caught, not just a
// theoretical leak — an effect applied to a hidden participant used to
// still broadcast room-wide, so a player's client (which has no row for
// that participant) just silently dropped it, and it never appeared even
// once the participant was later revealed (FULL_STATE_SYNC on reveal
// carries the participant's CURRENT effects, but the player never got the
// APPLIED event that would have shown it arriving). Gating this on
// visibility fixes both problems at once: no leak while hidden, and a
// correct APPLIED/EXPIRED history once the reveal's FULL_STATE_SYNC
// resync exposes the participant. Looked up by encounter + target
// (character_id/monster_instance_id) since neither EffectSyncTarget nor
// EffectBroadcastRow carries a participant id.
export async function broadcastEffectApplied(io: Server, sync: EffectSyncTarget, effect: EffectBroadcastRow, effectDefinitionName: string): Promise<void> {
  const visible = await isEncounterTargetVisibleToPlayers(pool, sync.encounter_id, effect.character_id, effect.monster_instance_id);
  await emitToEncounterRespectingVisibility(
    io,
    sync.campaign_id,
    sync.encounter_id,
    'EFFECT_APPLIED',
    effectPayloadBase(sync, effect, effectDefinitionName),
    visible,
  );
}

export async function broadcastEffectExpired(io: Server, sync: EffectSyncTarget, effect: EffectBroadcastRow, effectDefinitionName: string): Promise<void> {
  // durationRemaining is forced to 0 here regardless of the row's stored
  // duration_value — "expired" means zero remaining by definition, whether
  // it got there via the automatic per-round decrement or a DM manually
  // removing an effect early (whose duration_value may still be positive).
  const visible = await isEncounterTargetVisibleToPlayers(pool, sync.encounter_id, effect.character_id, effect.monster_instance_id);
  const payload = { ...effectPayloadBase(sync, effect, effectDefinitionName), durationRemaining: 0 };
  await emitToEncounterRespectingVisibility(io, sync.campaign_id, sync.encounter_id, 'EFFECT_EXPIRED', payload, visible);
}

// ---- CONCENTRATION_CHECK_PROMPTED ----
//
// Phase 2 "concentration-broken save prompt" — targeted, not room-wide or
// role-split: DM + the concentrating character's controller (controller_
// user_id falling back to owner_user_id, mirroring requireControllerOrDm's
// own audience), computed fresh from campaign_members same as
// diceRollRecipientSocketIds (never trust a cached role on the socket).
// A monster instance has no controller (controllerUserId is null) — DM
// only, which is correct: nothing here is for a player to act on.
export interface ConcentrationCheckTarget {
  encounterId: string;
  campaignId: string;
  characterId: string | null;
  monsterInstanceId: string | null;
  effectId: string;
  effectDefinitionId: string;
  effectName: string;
  dc: number;
  damage: number;
  controllerUserId: string | null;
}

export async function broadcastConcentrationCheckPrompted(io: Server, target: ConcentrationCheckTarget): Promise<void> {
  const room = campaignRoom(target.campaignId);
  const sockets = await io.in(room).fetchSockets();
  if (sockets.length === 0) return;

  const userIds = [...new Set(sockets.map((s) => (s.data as SocketData).userId))];
  const roleRes = await pool.query<{ user_id: string; role: CampaignRole }>(
    `SELECT user_id, role FROM campaign_members WHERE campaign_id = $1 AND user_id = ANY($2::uuid[])`,
    [target.campaignId, userIds],
  );
  const roleByUser = new Map(roleRes.rows.map((r) => [r.user_id, r.role]));

  const recipientIds = sockets
    .filter((s) => {
      const userId = (s.data as SocketData).userId;
      return roleByUser.get(userId) === 'dm' || (target.controllerUserId != null && userId === target.controllerUserId);
    })
    .map((s) => s.id);
  if (recipientIds.length === 0) return;

  io.to(recipientIds).emit('CONCENTRATION_CHECK_PROMPTED', {
    encounterId: target.encounterId,
    campaignId: target.campaignId,
    serverTimestamp: Date.now(),
    characterId: target.characterId,
    monsterInstanceId: target.monsterInstanceId,
    effectId: target.effectId,
    effectDefinitionId: target.effectDefinitionId,
    effectName: target.effectName,
    dc: target.dc,
    damage: target.damage,
  });
}

// ---- FULL_STATE_SYNC — always a fresh DB read, never cached ----

// One participant's currently-active effects, keyed the same way a
// combat_participants row targets a character XOR a monster instance —
// looked up by target rather than by active_effects.encounter_id, since an
// effect applied via the outside-combat /characters/:id/effects or
// /monster-instances/:id/effects routes has encounter_id = null even when
// its target is a live participant here (see services/effects.ts's
// resolveEncounterSyncs) — the snapshot should still show it.
interface ActiveEffectRow {
  id: string;
  character_id: string | null;
  monster_instance_id: string | null;
  effect_definition_id: string;
  name: string;
  duration_type: string;
  duration_value: number | null;
  concentration: boolean;
  source_character_id: string | null;
}

function effectTargetKey(characterId: string | null, monsterInstanceId: string | null): string {
  return characterId != null ? `c:${characterId}` : `m:${monsterInstanceId}`;
}

function formatEffectForWire(e: ActiveEffectRow) {
  return {
    effectId: e.id,
    effectDefinitionId: e.effect_definition_id,
    name: e.name,
    durationType: e.duration_type,
    durationRemaining: e.duration_value,
    concentration: e.concentration,
    sourceCharacterId: e.source_character_id,
  };
}

// Armor class/effect *fields* are still always-visible for any row a viewer
// can see at all (hide/reveal for those was removed; the one remaining
// field-level redaction, monster-instance weaknesses, isn't part of this
// payload — it's read via GET /monster-instances/:id, which still redacts).
// HP is the one exception, reintroduced by Phase 2 (1784269801666_restore-
// hp-visibility.ts) — see resolveHpForViewer just below. What ALSO splits by
// role (nav point 1): whether a participant ROW is present at all — a
// non-DM viewer never receives a hidden (visible_to_players = false)
// participant, full stop, not even a redacted stub.

export type HpForWire =
  | { hpVisibility: 'exact' | 'banded' | 'hidden'; hpCurrent: number; hpMax: number; hpTemp: number }
  | { hpVisibility: 'banded'; band: HpBand }
  | { hpVisibility: 'hidden' };

// Pure and exported for the same reason buildDiceRollBroadcastPayloads is
// (Phase 2 "hidden rolls record occurrence") — directly unit-testable
// without a socket.io harness. The DM branch returns the row's REAL
// hp_visibility (so the DM's own UI can show what a player currently sees)
// alongside the true numbers regardless of that setting; a non-DM viewer
// gets numbers only when the setting is 'exact', a computed band only when
// 'banded', and nothing at all when 'hidden'.
//
// `isCharacter` (character_id != null, i.e. NOT a monster instance) always
// forces the exact branch too, even for a non-DM viewer, regardless of
// hp_visibility — the confirmed scope for this feature was "monster HP
// gets its hidden/qualitative state back," never party HP. combat_participants
// still defaults every new row (PCs included) to hp_visibility='banded', so
// without this the whole party's own HP would go banded-by-default, which
// no one asked for and no player-facing UI should ever let happen. This is
// also this app's pre-Phase-2 baseline for characters specifically — HP was
// always visible to every campaign member for every participant before this
// feature existed; Phase 2 narrows that to monster instances only, not
// narrower still to "just your own PC" (which would need a per-USER
// payload, not the per-ROLE one this whole file computes once and shares
// across every connected player).
export function resolveHpForViewer(
  hp: { hpCurrent: number; hpMax: number; hpTemp: number; hpVisibility: 'exact' | 'banded' | 'hidden' },
  viewerRole: CampaignRole,
  isCharacter: boolean,
): HpForWire {
  if (viewerRole === 'dm' || isCharacter || hp.hpVisibility === 'exact') {
    return { hpVisibility: hp.hpVisibility, hpCurrent: hp.hpCurrent, hpMax: hp.hpMax, hpTemp: hp.hpTemp };
  }
  if (hp.hpVisibility === 'banded') {
    return { hpVisibility: 'banded', band: bandHp(hp.hpCurrent, hp.hpMax) };
  }
  return { hpVisibility: 'hidden' };
}

export async function buildFullStateSyncPayload(
  poolOrClient: Pool | PoolClient,
  encounterId: string,
  campaignId: string,
  viewerRole: CampaignRole,
): Promise<Record<string, unknown>> {
  const snapshot = await getEncounterCombatSnapshot(poolOrClient, encounterId);
  const { encounter, participants } = snapshot;

  const active = participants.find((p) => p.turn_order === encounter.current_turn_index);

  const characterIds = participants.filter((p) => p.character_id != null).map((p) => p.character_id as string);
  const monsterInstanceIds = participants.filter((p) => p.monster_instance_id != null).map((p) => p.monster_instance_id as string);

  const effectsRes = await poolOrClient.query<ActiveEffectRow>(
    `SELECT ae.id, ae.character_id, ae.monster_instance_id, ae.effect_definition_id, ed.name,
            ae.duration_type, ae.duration_value, ae.concentration, ae.source_character_id
     FROM active_effects ae
     JOIN effect_definitions ed ON ed.id = ae.effect_definition_id
     WHERE ae.removed_at IS NULL
       AND ((ae.character_id = ANY($1::uuid[])) OR (ae.monster_instance_id = ANY($2::uuid[])))`,
    [characterIds, monsterInstanceIds],
  );
  const effectsByTarget = new Map<string, ActiveEffectRow[]>();
  for (const e of effectsRes.rows) {
    const key = effectTargetKey(e.character_id, e.monster_instance_id);
    const list = effectsByTarget.get(key) ?? [];
    list.push(e);
    effectsByTarget.set(key, list);
  }

  const participantsOut = participants.map((p) => ({
    participantId: p.participant_id,
    characterId: p.character_id,
    monsterInstanceId: p.monster_instance_id,
    name: p.name,
    initiativeRoll: p.initiative_roll,
    initiativeTiebreak: p.initiative_tiebreak,
    turnOrder: p.turn_order,
    posX: p.pos_x,
    posY: p.pos_y,
    actionUsed: p.action_used,
    bonusActionUsed: p.bonus_action_used,
    reactionUsed: p.reaction_used,
    dashUsed: p.dash_used,
    movementUsedFt: p.movement_used_ft,
    objectInteractionUsed: p.object_interaction_used,
    speedFt: p.speed_ft,
    monsterInstanceStatus: p.monster_instance_status,
    size: p.size,
    faction: p.faction,
    imageUrl: p.image_url,
    armorClass: p.armor_class,
    hp: resolveHpForViewer(
      { hpCurrent: p.hp_current, hpMax: p.hp_max, hpTemp: p.hp_temp, hpVisibility: p.hp_visibility },
      viewerRole,
      p.character_id != null,
    ),
    effects: (effectsByTarget.get(effectTargetKey(p.character_id, p.monster_instance_id)) ?? []).map(formatEffectForWire),
    visibleToPlayers: p.visible_to_players,
    legendaryActionsRemaining: p.legendary_actions_remaining,
  }));

  // DM always gets every row; a non-DM viewer never receives one with
  // visible_to_players = false. activeParticipantId is left pointing at the
  // true active participant even if that one happens to be hidden — a
  // player's client just won't find a matching row to highlight, which
  // degrades gracefully (no highlight) without leaking who it actually is.
  const visibleParticipantsOut =
    viewerRole === 'dm' ? participantsOut : participantsOut.filter((p) => p.visibleToPlayers !== false);

  // No DM/player split for map config — same as the MAP_UPDATED/TOKEN_MOVED
  // broadcasts, this isn't sensitive info.
  const map = await getEncounterMap(poolOrClient, encounterId);

  // Same no-split rule as `map` above — including for 'note' elements; the
  // client is what hides notes from non-DM viewers (see
  // broadcastMapElementsChanged's header comment).
  const mapElements = (await listMapElements(poolOrClient, encounterId)).map(formatMapElementForWire);

  return {
    encounterId: encounter.id,
    campaignId: encounter.campaign_id,
    seq: encounter.sync_seq,
    serverTimestamp: Date.now(),
    encounter: {
      status: encounter.status,
      mode: encounter.mode,
      disposition: encounter.disposition,
      currentRound: encounter.current_round,
      currentTurnIndex: encounter.current_turn_index,
    },
    activeParticipantId: active?.participant_id ?? null,
    participants: visibleParticipantsOut,
    map: formatMapForWire(map),
    mapElements,
  };
}

// Pushes a fresh FULL_STATE_SYNC to every currently-connected socket in an
// encounter room — used after an encounter-wide weakness-reveal reset, and
// after a participant-visibility toggle (nav point 1), where a single
// shared payload would either leak a hidden participant to players or hide
// it from the DM too. Two payloads, computed once each and fanned out to
// the matching socket ids, same "compute per-role server-side, never a
// client-side redaction flag" rule as splitSocketsByRole's own header.
export async function broadcastFullStateResync(io: Server, encounterId: string, campaignId: string): Promise<void> {
  const room = encounterRoom(encounterId);
  const { dmSocketIds, playerSocketIds } = await splitSocketsByRole(io, campaignId, room);

  if (dmSocketIds.length > 0) {
    const dmPayload = await buildFullStateSyncPayload(pool, encounterId, campaignId, 'dm');
    io.to(dmSocketIds).emit('FULL_STATE_SYNC', dmPayload);
  }
  if (playerSocketIds.length > 0) {
    const playerPayload = await buildFullStateSyncPayload(pool, encounterId, campaignId, 'player');
    io.to(playerSocketIds).emit('FULL_STATE_SYNC', playerPayload);
  }
}

// ---- DICE_ROLLED (Phase 3.4) ----
//
// Unlike every other broadcast in this file, a dice roll is NOT necessarily
// tied to a live encounter — `encounter_id` is nullable (PLAN.md §3.5: rolls
// can happen outside combat) — so this always targets
// campaignRoom(campaignId), never encounterRoom(encounterId), even when the
// roll does carry an encounterId. Per this repo's room topology (PLAN.md
// §5.1) every client joins campaign:{id} on connect, while encounter:{id} is
// only joined by clients currently active in that specific encounter; an
// encounter-room broadcast would silently miss anyone who hasn't joined that
// room (or, for an out-of-combat roll, anyone at all).
//
// Always a plain room-wide emit — the DM-only-hidden-roll option
// (`dice_rolls.visible_to_players`) was removed along with the rest of the
// hide/reveal feature.
//
// No `seq` field: sync_seq is the encounters table's gap-detection counter
// for turn-sequencing state (see envelope() above), bumped in lockstep with
// encounter mutations so a client can detect a missed message. A dice roll
// isn't part of that state machine and has no sync_seq of its own to report
// — forcing one here (e.g. reusing the encounter's current sync_seq when
// encounterId happens to be set) would be meaningless for a roll made
// outside combat, and would wrongly imply this event participates in
// useEncounterLive's seq-gap detection on the frontend. The frontend's
// dice-roll history should just append DICE_ROLLED payloads on receipt, not
// run them through that gap-check.
export interface DiceRollBroadcastRow {
  id: string;
  campaign_id: string;
  user_id: string;
  character_id: string | null;
  monster_instance_id: string | null;
  encounter_id: string | null;
  roll_type: string;
  roll_context: string | null;
  d20_rolls: number[];
  keep: string;
  dice_sides: number;
  dice_count: number;
  modifier: number;
  result_total: number;
  is_critical: boolean;
  visibility: 'public' | 'gm_only' | 'private';
  visible_to_user_id: string | null;
  is_manual: boolean;
  created_at: Date | string;
}

// Iteration 3 §2.4 visibility, reusing services/diceRolls.ts's
// isRollVisibleToViewer directly (this used to hand-roll its own copy of
// that exact rule — collapsed onto services/visibility.ts's shared logic as
// part of Phase 1.1) — just expressed over live sockets instead of a DB row.
// A single fetchSockets() call, filtered in JS, rather than the room-split-
// then-refetch pattern used elsewhere in this file.
//
// Returns BOTH sets (Phase 2 "hidden rolls record occurrence"): `fullIds`
// gets the real DICE_ROLLED payload, `maskedIds` is everyone else in the
// room who's still allowed to know a roll HAPPENED (a masked stub — see
// broadcastDiceRolled) without seeing its value. broadcastDiceRollVoided
// deliberately keeps using only `fullIds` (via diceRollRecipientSocketIds
// below) — a socket that never got told a hidden roll happened must not be
// told it was voided either.
async function splitDiceRollRecipients(
  io: Server,
  campaignId: string,
  roll: DiceRollBroadcastRow,
): Promise<{ fullIds: string[]; maskedIds: string[] }> {
  const room = campaignRoom(campaignId);
  const sockets = await io.in(room).fetchSockets();
  if (sockets.length === 0) return { fullIds: [], maskedIds: [] };
  if (roll.visibility === 'public') return { fullIds: sockets.map((s) => s.id), maskedIds: [] };

  const userIds = [...new Set(sockets.map((s) => (s.data as SocketData).userId))];
  const roleRes = await pool.query<{ user_id: string; role: CampaignRole }>(
    `SELECT user_id, role FROM campaign_members WHERE campaign_id = $1 AND user_id = ANY($2::uuid[])`,
    [campaignId, userIds],
  );
  const roleByUser = new Map(roleRes.rows.map((r) => [r.user_id, r.role]));

  const fullIds: string[] = [];
  const maskedIds: string[] = [];
  for (const s of sockets) {
    const userId = (s.data as SocketData).userId;
    if (isRollVisibleToViewer(roll, userId, roleByUser.get(userId) ?? 'player')) fullIds.push(s.id);
    else maskedIds.push(s.id);
  }
  return { fullIds, maskedIds };
}

async function diceRollRecipientSocketIds(io: Server, campaignId: string, roll: DiceRollBroadcastRow): Promise<string[]> {
  return (await splitDiceRollRecipients(io, campaignId, roll)).fullIds;
}

// ---- BESTIARY_UPDATED (Task 1 — per-campaign bestiary) ----
//
// A bare invalidation signal, not a full-payload event like HP_CHANGED:
// computing a role-correct entry payload here would risk leaking an
// undiscovered creature to a player over the socket. The client just
// refetches GET /campaigns/:id/bestiary on receipt, which already applies
// the discovered-only filter server-side.
export function broadcastBestiaryUpdated(io: Server, campaignId: string): void {
  io.to(campaignRoom(campaignId)).emit('BESTIARY_UPDATED', { campaignId, serverTimestamp: Date.now() });
}

// Iteration 3 minor sweep — spending/recovering a resource pool (ki points,
// rage uses, spell slots) never broadcast anything at all, unlike every
// other combat-relevant mutation in this app, which is disciplined about
// this. Same-player-two-tabs (or a delegated controller + the owner, both
// watching the same character sheet) went stale until an unrelated event
// forced a refetch. Campaign-room, not encounter-room — a resource pool can
// be spent/recovered outside combat too (short/long rest, out-of-combat
// spellcasting), same "not necessarily encounter-scoped" reasoning
// DICE_ROLLED already uses.
export function broadcastResourcePoolChanged(
  io: Server,
  campaignId: string,
  characterId: string,
  resource: Record<string, unknown>,
): void {
  io.to(campaignRoom(campaignId)).emit('RESOURCE_POOL_CHANGED', {
    campaignId,
    serverTimestamp: Date.now(),
    characterId,
    resource,
  });
}

// Pure and exported so Phase 2's "hidden rolls record occurrence" masking
// rule is directly unit-testable — this codebase has no socket.io test
// harness precedent (see broadcastVisibility.integration.test.ts's header
// comment), so the actual io.to(...).emit(...) plumbing below stays
// untested the same way every other broadcast in this file is, but the
// payload SHAPE (what a masked recipient can and can't see) doesn't have to.
export function buildDiceRollBroadcastPayloads(campaignId: string, roll: DiceRollBroadcastRow, serverTimestamp: number) {
  const full = {
    masked: false as const,
    campaignId,
    serverTimestamp,
    id: roll.id,
    rollType: roll.roll_type,
    rollContext: roll.roll_context,
    d20Rolls: roll.d20_rolls,
    keep: roll.keep,
    diceSides: roll.dice_sides,
    diceCount: roll.dice_count,
    modifier: roll.modifier,
    resultTotal: roll.result_total,
    isCritical: roll.is_critical,
    visibility: roll.visibility,
    isManual: roll.is_manual,
    characterId: roll.character_id,
    monsterInstanceId: roll.monster_instance_id,
    encounterId: roll.encounter_id,
    userId: roll.user_id,
    createdAt: roll.created_at,
  };
  // id/roller/context/type present, every result-bearing field stripped.
  // Previously a socket that couldn't see a gm_only/private roll got NO
  // event at all — a hidden saving throw against the party looked, live,
  // like nothing happened.
  const masked = {
    masked: true as const,
    campaignId,
    serverTimestamp,
    id: roll.id,
    rollType: roll.roll_type,
    rollContext: roll.roll_context,
    visibility: roll.visibility,
    characterId: roll.character_id,
    monsterInstanceId: roll.monster_instance_id,
    encounterId: roll.encounter_id,
    userId: roll.user_id,
    createdAt: roll.created_at,
  };
  return { full, masked };
}

export async function broadcastDiceRolled(io: Server, campaignId: string, roll: DiceRollBroadcastRow): Promise<void> {
  const { full, masked } = buildDiceRollBroadcastPayloads(campaignId, roll, Date.now());
  const { fullIds, maskedIds } = await splitDiceRollRecipients(io, campaignId, roll);
  if (fullIds.length > 0) io.to(fullIds).emit('DICE_ROLLED', full);
  if (maskedIds.length > 0) io.to(maskedIds).emit('DICE_ROLLED', masked);
}

// Void, not delete (Iteration 3 §2.4) — same recipient set as the original
// DICE_ROLLED, so a player who could never see a 'gm_only'/private roll in
// the first place doesn't even learn one existed and got voided.
export async function broadcastDiceRollVoided(io: Server, campaignId: string, roll: DiceRollBroadcastRow): Promise<void> {
  const recipientIds = await diceRollRecipientSocketIds(io, campaignId, roll);
  if (recipientIds.length === 0) return;
  io.to(recipientIds).emit('DICE_ROLL_VOIDED', { campaignId, serverTimestamp: Date.now(), id: roll.id });
}

// ---- Dice roll requests (Iteration 3 §2.3) ----
//
// Room-wide, unlike DICE_ROLLED — request metadata (roll type, context, DC,
// who's targeted, who's responded) isn't HP/position-sensitive info the way
// combat state is; matches the "whole table can see who's rolled" spirit of
// a tabletop group check. The underlying ROLL a target fulfilled with still
// respects its own visibility via DICE_ROLLED/the roll-log read path — this
// event only ever carries request/target metadata, never a roll's value.
export function broadcastDiceRollRequested(
  io: Server,
  campaignId: string,
  request: { id: string; roll_type: string; roll_context: string | null; dc: number | null; encounter_id: string | null },
  targetUserIds: string[],
): void {
  io.to(campaignRoom(campaignId)).emit('DICE_ROLL_REQUESTED', {
    campaignId,
    serverTimestamp: Date.now(),
    id: request.id,
    rollType: request.roll_type,
    rollContext: request.roll_context,
    dc: request.dc,
    encounterId: request.encounter_id,
    targetUserIds,
  });
}

export function broadcastDiceRollRequestUpdated(
  io: Server,
  campaignId: string,
  target: { id: string; request_id: string; status: string; dice_roll_id: string | null },
): void {
  io.to(campaignRoom(campaignId)).emit('DICE_ROLL_REQUEST_UPDATED', {
    campaignId,
    serverTimestamp: Date.now(),
    targetId: target.id,
    requestId: target.request_id,
    status: target.status,
    diceRollId: target.dice_roll_id,
  });
}

// ---- ENCOUNTER_OPENED / ENCOUNTER_FULLSCREEN_FORCED (map-first encounter system) ----
//
// Pushes a "go fullscreen now" navigation signal to exactly the sockets that
// should act on it: the campaign's DM (always relevant — they're the one who
// opened it) and any player who owns a character seated as a
// combat_participants row in this encounter. Targeted the same way
// pushEncounterRoomJoinForOwner (above) resolves "which of this player's
// currently-connected sockets" rather than broadcasting to the whole
// campaign room and asking every client to self-filter — participants are
// DM-only to add, so a player with no stake in this encounter has no
// business being told it exists yet, same discipline 'preparing'-status
// invisibility already applies elsewhere in this file.
async function relevantSocketIds(io: Server, pool_: Pool, campaignId: string, encounterId: string): Promise<string[]> {
  const campaignSockets = await io.in(campaignRoom(campaignId)).fetchSockets();
  if (campaignSockets.length === 0) return [];

  const relevantUserIds = new Set<string>();
  const dmRes = await pool_.query<{ dm_user_id: string }>(`SELECT dm_user_id FROM campaigns WHERE id = $1`, [campaignId]);
  const dmUserId = dmRes.rows[0]?.dm_user_id;
  if (dmUserId) relevantUserIds.add(dmUserId);

  const ownersRes = await pool_.query<{ owner_user_id: string }>(
    `SELECT DISTINCT c.owner_user_id
     FROM combat_participants cp
     JOIN characters c ON c.id = cp.character_id
     WHERE cp.encounter_id = $1 AND c.owner_user_id IS NOT NULL`,
    [encounterId],
  );
  for (const row of ownersRes.rows) relevantUserIds.add(row.owner_user_id);

  return campaignSockets.filter((s) => relevantUserIds.has((s.data as SocketData).userId)).map((s) => s.id);
}

// `forced` picks the event name rather than a payload flag (two distinct,
// unambiguous event names, same choice this file already makes elsewhere
// rather than a single event + mode field) — the client-side listener uses
// the name alone to decide whether to override a player's own "I minimized
// this" preference (ENCOUNTER_FULLSCREEN_FORCED) or respect it
// (ENCOUNTER_OPENED).
export async function broadcastEncounterOpened(
  io: Server,
  pool_: Pool,
  encounter: EncounterLike,
  name: string,
  forced: boolean,
): Promise<void> {
  const socketIds = await relevantSocketIds(io, pool_, encounter.campaign_id, encounter.id);
  if (socketIds.length === 0) return;
  io.to(socketIds).emit(forced ? 'ENCOUNTER_FULLSCREEN_FORCED' : 'ENCOUNTER_OPENED', {
    encounterId: encounter.id,
    campaignId: encounter.campaign_id,
    name,
    serverTimestamp: Date.now(),
  });
}

// ---- ACTION_RECORDED (nav point 2 — combat log) ----
//
// No sync_seq bump / resync discipline here, unlike FULL_STATE_SYNC: a
// missed event just leaves the combat log panel one line behind until its
// next paginated fetch, much lower-stakes than missing an HP/position
// change. Role-split for the same reason as FULL_STATE_SYNC (nav point 1) —
// an action touching a currently-hidden participant must never reach a
// player's socket at all.
export async function broadcastActionRecorded(
  io: Server,
  poolOrClient: Pool,
  action: CombatActionView,
  campaignId: string,
): Promise<void> {
  const room = encounterRoom(action.encounterId);
  const { dmSocketIds, playerSocketIds } = await splitSocketsByRole(io, campaignId, room);
  const payload = { encounterId: action.encounterId, campaignId, serverTimestamp: Date.now(), action };

  if (dmSocketIds.length > 0) {
    io.to(dmSocketIds).emit('ACTION_RECORDED', payload);
  }
  if (playerSocketIds.length > 0) {
    const visibleToPlayers = await isActionVisibleToPlayers(poolOrClient, action.encounterId, action);
    if (visibleToPlayers) io.to(playerSocketIds).emit('ACTION_RECORDED', payload);
  }
}

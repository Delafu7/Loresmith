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
import { buildHpVariants, type HpVisibility } from '../services/hpVisibility.js';
import { getEncounterCombatSnapshot, getEncounterMap, formatMapForWire } from '../services/encounters.js';
import type { EncounterMapRow } from '../services/encounters.js';
import type { CampaignRole } from '../services/authz.js';

export function getIo(app: Application): Server {
  const io = app.get('io') as Server | undefined;
  if (!io) throw new Error('Socket.io server not attached to the Express app (app.set("io", ...) never ran)');
  return io;
}

interface EncounterLike {
  id: number;
  campaign_id: number;
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
  campaignId: number,
  room: string,
): Promise<{ dmSocketIds: string[]; playerSocketIds: string[] }> {
  const socketsInRoom = await io.in(room).fetchSockets();
  if (socketsInRoom.length === 0) return { dmSocketIds: [], playerSocketIds: [] };

  const userIds = [...new Set(socketsInRoom.map((s) => (s.data as SocketData).userId))];
  const roleRes = await pool.query<{ user_id: number; role: CampaignRole }>(
    `SELECT user_id, role FROM campaign_members WHERE campaign_id = $1 AND user_id = ANY($2::bigint[])`,
    [campaignId, userIds],
  );
  const roleByUser = new Map(roleRes.rows.map((r) => [Number(r.user_id), r.role]));

  const dmSocketIds: string[] = [];
  const playerSocketIds: string[] = [];
  for (const s of socketsInRoom) {
    const role = roleByUser.get((s.data as SocketData).userId);
    (role === 'dm' ? dmSocketIds : playerSocketIds).push(s.id);
  }
  return { dmSocketIds, playerSocketIds };
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

export function broadcastInitiativeRolled(
  io: Server,
  encounter: EncounterLike,
  participants: Array<{ id: number; initiative_roll: number; initiative_tiebreak: number | null; turn_order: number }>,
): void {
  io.to(encounterRoom(encounter.id)).emit('INITIATIVE_ROLLED', {
    ...envelope(encounter),
    // no HP in payload, per PLAN.md §5.2
    participants: participants.map((p) => ({
      participantId: p.id,
      initiativeRoll: p.initiative_roll,
      initiativeTiebreak: p.initiative_tiebreak,
      turnOrder: p.turn_order,
    })),
  });
}

export function broadcastTurnAdvanced(
  io: Server,
  encounter: EncounterLike,
  participants: Array<{ id: number; turn_order: number }>,
): void {
  const active = participants.find((p) => p.turn_order === encounter.current_turn_index);
  io.to(encounterRoom(encounter.id)).emit('TURN_ADVANCED', {
    ...envelope(encounter),
    currentRound: encounter.current_round,
    currentTurnIndex: encounter.current_turn_index,
    activeParticipantId: active?.id ?? null,
  });
}

export function broadcastParticipantJoined(
  io: Server,
  encounter: EncounterLike,
  participant: { id: number; character_id: number | null; monster_instance_id: number | null; initiative_roll: number; turn_order: number; hp_visibility: string },
): void {
  io.to(encounterRoom(encounter.id)).emit('PARTICIPANT_JOINED', {
    ...envelope(encounter),
    participant: {
      participantId: participant.id,
      characterId: participant.character_id,
      monsterInstanceId: participant.monster_instance_id,
      initiativeRoll: participant.initiative_roll,
      turnOrder: participant.turn_order,
      hpVisibility: participant.hp_visibility,
    },
  });
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
  encounterId: number,
  campaignId: number,
  characterId: number | null,
): Promise<void> {
  if (characterId === null) return;
  const ownerRes = await pool_.query<{ owner_user_id: number | null }>(
    `SELECT owner_user_id FROM characters WHERE id = $1`,
    [characterId],
  );
  const ownerUserId = ownerRes.rows[0]?.owner_user_id;
  if (ownerUserId == null) return;

  const room = encounterRoom(encounterId);
  const campaignSockets = await io.in(campaignRoom(campaignId)).fetchSockets();
  const targets = campaignSockets.filter(
    (s) => (s.data as SocketData).userId === Number(ownerUserId) && !s.rooms.has(room),
  );
  if (targets.length === 0) return;

  await Promise.all(targets.map((s) => s.join(room)));
  const syncPayload = await buildFullStateSyncPayload(pool_, encounterId, campaignId, 'player');
  for (const s of targets) s.emit('FULL_STATE_SYNC', syncPayload);
}

export function broadcastParticipantLeft(
  io: Server,
  encounter: EncounterLike,
  participant: { id: number; character_id: number | null; monster_instance_id: number | null },
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
    backgroundAssetId: map.background_asset_id,
    backgroundFileUrl: map.background_file_url,
    gridColumns: map.grid_columns,
    gridRows: map.grid_rows,
    cellSizePx: map.cell_size_px,
  });
}

export function broadcastTokenMoved(
  io: Server,
  encounter: EncounterLike,
  participant: { id: number; pos_x: number | null; pos_y: number | null },
): void {
  io.to(encounterRoom(encounter.id)).emit('TOKEN_MOVED', {
    ...envelope(encounter),
    participantId: participant.id,
    x: participant.pos_x,
    y: participant.pos_y,
  });
}

// ---- ACTION_ECONOMY_CHANGED (Phase 3.6) ----
//
// Same "no DM/player visibility split" reasoning as MAP_UPDATED/TOKEN_MOVED
// just above — whether a participant has spent their action this turn isn't
// HP-sensitive info, so this is a plain room-wide broadcast too.
export function broadcastActionEconomyChanged(
  io: Server,
  encounter: EncounterLike,
  participant: {
    id: number;
    action_used: boolean;
    bonus_action_used: boolean;
    reaction_used: boolean;
    dash_used: boolean;
    movement_used_ft: number;
  },
): void {
  io.to(encounterRoom(encounter.id)).emit('ACTION_ECONOMY_CHANGED', {
    ...envelope(encounter),
    participantId: participant.id,
    actionUsed: participant.action_used,
    bonusActionUsed: participant.bonus_action_used,
    reactionUsed: participant.reaction_used,
    dashUsed: participant.dash_used,
    movementUsedFt: participant.movement_used_ft,
  });
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
  encounter_id: number;
  campaign_id: number;
  sync_seq: number;
}

export function broadcastArmorClassChanged(
  io: Server,
  sync: ArmorClassSyncTarget,
  participant: { participantId: number; characterId: number; armorClass: number },
): void {
  io.to(encounterRoom(sync.encounter_id)).emit('PARTICIPANT_AC_CHANGED', {
    encounterId: sync.encounter_id,
    campaignId: sync.campaign_id,
    seq: sync.sync_seq,
    serverTimestamp: Date.now(),
    participantId: participant.participantId,
    characterId: participant.characterId,
    armorClass: participant.armorClass,
  });
}

// ---- HP_CHANGED — the one event with a mandatory visibility split ----

export interface HpChangeTarget {
  encounterId: number;
  campaignId: number;
  seq: number;
  participantId: number;
  characterId: number | null;
  monsterInstanceId: number | null;
  hpVisibility: HpVisibility;
  hpCurrent: number;
  hpMax: number;
  hpTemp: number;
  delta: number;
}

export async function broadcastHpChanged(io: Server, target: HpChangeTarget): Promise<void> {
  const { dmSocketIds, playerSocketIds } = await splitSocketsByRole(io, target.campaignId, encounterRoom(target.encounterId));
  const { dmPayload, playerPayload } = buildHpVariants(target.hpVisibility, target.hpCurrent, target.hpMax, target.hpTemp);

  const base = {
    encounterId: target.encounterId,
    campaignId: target.campaignId,
    seq: target.seq,
    serverTimestamp: Date.now(),
    participantId: target.participantId,
    characterId: target.characterId,
    monsterInstanceId: target.monsterInstanceId,
    changeType: target.delta > 0 ? 'heal' : target.delta < 0 ? 'damage' : 'none',
  };

  if (dmSocketIds.length > 0) {
    io.to(dmSocketIds).emit('HP_CHANGED', { ...base, hp: dmPayload });
  }
  // playerPayload is null exactly when hp_visibility === 'hidden' — per
  // PLAN.md §5.3, "hidden sends nothing," so players don't get this event
  // at all for that participant (not an event with an empty hp field).
  if (playerPayload !== null && playerSocketIds.length > 0) {
    io.to(playerSocketIds).emit('HP_CHANGED', { ...base, hp: playerPayload });
  }
}

// ---- EFFECT_APPLIED / EFFECT_EXPIRED ----
//
// Deferred from Phase 1 (PLAN.md §5.2 lists them, but `active_effects` didn't
// exist yet). Hooked into services/effects.ts the same way HP_CHANGED is
// hooked into the HP-delta routes: routes/*.ts calls one of these two thin
// functions once per `EncounterEffectSyncTarget` returned by the service
// (there can be more than one — see services/effects.ts's
// resolveEncounterSyncs — when an effect is applied/removed via the
// outside-combat character/monster-instance endpoints while that target
// happens to be a live participant in one or more encounters).
//
// Visibility: `active_effects.visible_to_players` is a binary DM-hidden flag
// (not a three-way band like HP), so there's no "redacted-but-present"
// player payload the way banded HP works — a hidden effect is either sent
// to the whole room (visible) or DM-only sockets (hidden). Same "compute
// server-side, never a client-side flag" discipline as HP_CHANGED/§5.2's key
// rule: a hidden effect's existence must never reach a player socket at all.
//
// Batching choice for automatic round-based expiry (services/encounters.ts's
// advanceTurn can expire several 'rounds' effects on one turn advance): ONE
// EFFECT_EXPIRED event PER expired effect, not a single batched event with an
// array. Reasons: (1) it reuses this exact function for both the manual
// DELETE /effects/:id path and the automatic per-round decrement path with
// no second payload shape to maintain; (2) visibility filtering stays
// trivial per-event (room broadcast vs. DM-only) instead of needing to
// partition a mixed visible/hidden array per recipient; (3) all events from
// one advanceTurn call legitimately share the same `seq` (the turn-advance
// and the round decrement are one atomic transaction/mutation), so a client
// tracking seq gaps sees them as belonging together without needing them
// wrapped in one message.

export interface EffectSyncTarget {
  encounter_id: number;
  campaign_id: number;
  sync_seq: number;
}

export interface EffectBroadcastRow {
  id: number;
  character_id: number | null;
  monster_instance_id: number | null;
  effect_definition_id: number;
  duration_type: string;
  duration_value: number | null;
  concentration: boolean;
  source_character_id: number | null;
  visible_to_players: boolean;
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

async function emitEffectEvent(
  io: Server,
  event: 'EFFECT_APPLIED' | 'EFFECT_EXPIRED',
  sync: EffectSyncTarget,
  payload: Record<string, unknown>,
  visibleToPlayers: boolean,
): Promise<void> {
  const room = encounterRoom(sync.encounter_id);
  if (visibleToPlayers) {
    io.to(room).emit(event, payload);
    return;
  }
  const { dmSocketIds } = await splitSocketsByRole(io, sync.campaign_id, room);
  if (dmSocketIds.length > 0) io.to(dmSocketIds).emit(event, payload);
}

export async function broadcastEffectApplied(
  io: Server,
  sync: EffectSyncTarget,
  effect: EffectBroadcastRow,
  effectDefinitionName: string,
): Promise<void> {
  const payload = effectPayloadBase(sync, effect, effectDefinitionName);
  await emitEffectEvent(io, 'EFFECT_APPLIED', sync, payload, effect.visible_to_players);
}

export async function broadcastEffectExpired(
  io: Server,
  sync: EffectSyncTarget,
  effect: EffectBroadcastRow,
  effectDefinitionName: string,
): Promise<void> {
  // durationRemaining is forced to 0 here regardless of the row's stored
  // duration_value — "expired" means zero remaining by definition, whether
  // it got there via the automatic per-round decrement or a DM manually
  // removing an effect early (whose duration_value may still be positive).
  const payload = { ...effectPayloadBase(sync, effect, effectDefinitionName), durationRemaining: 0 };
  await emitEffectEvent(io, 'EFFECT_EXPIRED', sync, payload, effect.visible_to_players);
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
  id: number;
  character_id: number | null;
  monster_instance_id: number | null;
  effect_definition_id: number;
  name: string;
  duration_type: string;
  duration_value: number | null;
  concentration: boolean;
  source_character_id: number | null;
  visible_to_players: boolean;
}

function effectTargetKey(characterId: number | null, monsterInstanceId: number | null): string {
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

export async function buildFullStateSyncPayload(
  poolOrClient: Pool | PoolClient,
  encounterId: number,
  campaignId: number,
  role: CampaignRole,
): Promise<Record<string, unknown>> {
  const snapshot = await getEncounterCombatSnapshot(poolOrClient, encounterId);
  const { encounter, participants } = snapshot;

  const active = participants.find((p) => p.turn_order === encounter.current_turn_index);

  const characterIds = participants.filter((p) => p.character_id != null).map((p) => p.character_id as number);
  const monsterInstanceIds = participants.filter((p) => p.monster_instance_id != null).map((p) => p.monster_instance_id as number);

  const effectsRes = await poolOrClient.query<ActiveEffectRow>(
    `SELECT ae.id, ae.character_id, ae.monster_instance_id, ae.effect_definition_id, ed.name,
            ae.duration_type, ae.duration_value, ae.concentration, ae.source_character_id, ae.visible_to_players
     FROM active_effects ae
     JOIN effect_definitions ed ON ed.id = ae.effect_definition_id
     WHERE ae.removed_at IS NULL
       AND ((ae.character_id = ANY($1::bigint[])) OR (ae.monster_instance_id = ANY($2::bigint[])))`,
    [characterIds, monsterInstanceIds],
  );
  const effectsByTarget = new Map<string, ActiveEffectRow[]>();
  for (const e of effectsRes.rows) {
    const key = effectTargetKey(e.character_id, e.monster_instance_id);
    const list = effectsByTarget.get(key) ?? [];
    list.push(e);
    effectsByTarget.set(key, list);
  }

  const rows = participants.map((p) => {
    const { dmPayload, playerPayload } = buildHpVariants(p.hp_visibility, p.hp_current, p.hp_max, p.hp_temp);
    const common = {
      participantId: p.participant_id,
      characterId: p.character_id,
      monsterInstanceId: p.monster_instance_id,
      name: p.name,
      initiativeRoll: p.initiative_roll,
      initiativeTiebreak: p.initiative_tiebreak,
      turnOrder: p.turn_order,
      hpVisibility: p.hp_visibility,
      armorClass: p.armor_class,
      posX: p.pos_x,
      posY: p.pos_y,
      actionUsed: p.action_used,
      bonusActionUsed: p.bonus_action_used,
      reactionUsed: p.reaction_used,
      dashUsed: p.dash_used,
      movementUsedFt: p.movement_used_ft,
      speedFt: p.speed_ft,
    };
    const targetEffects = effectsByTarget.get(effectTargetKey(p.character_id, p.monster_instance_id)) ?? [];
    const dmEffects = targetEffects.map(formatEffectForWire);
    const playerEffects = targetEffects.filter((e) => e.visible_to_players).map(formatEffectForWire);
    return { common, dmPayload, playerPayload, dmEffects, playerEffects };
  });

  const participantsOut =
    role === 'dm'
      ? rows.map((r) => ({ ...r.common, hp: r.dmPayload, effects: r.dmEffects }))
      : rows.filter((r) => r.playerPayload !== null).map((r) => ({ ...r.common, hp: r.playerPayload, effects: r.playerEffects }));

  // No DM/player split for map config — same as the MAP_UPDATED/TOKEN_MOVED
  // broadcasts, this isn't HP-sensitive info.
  const map = await getEncounterMap(poolOrClient, encounterId);

  return {
    encounterId: encounter.id,
    campaignId: encounter.campaign_id,
    seq: encounter.sync_seq,
    serverTimestamp: Date.now(),
    encounter: {
      status: encounter.status,
      currentRound: encounter.current_round,
      currentTurnIndex: encounter.current_turn_index,
    },
    activeParticipantId: active?.participant_id ?? null,
    participants: participantsOut,
    map: formatMapForWire(map),
  };
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
// Visibility split mirrors emitEffectEvent/broadcastEffectApplied exactly:
// visible_to_players=true is a plain room-wide emit, false goes through
// splitSocketsByRole to DM sockets only.
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
  id: number;
  campaign_id: number;
  user_id: number;
  character_id: number | null;
  monster_instance_id: number | null;
  encounter_id: number | null;
  roll_type: string;
  roll_context: string | null;
  d20_rolls: number[];
  keep: string;
  dice_sides: number;
  dice_count: number;
  modifier: number;
  result_total: number;
  visible_to_players: boolean;
  created_at: Date | string;
}

export async function broadcastDiceRolled(io: Server, campaignId: number, roll: DiceRollBroadcastRow): Promise<void> {
  const payload = {
    campaignId,
    serverTimestamp: Date.now(),
    id: roll.id,
    rollType: roll.roll_type,
    rollContext: roll.roll_context,
    d20Rolls: roll.d20_rolls,
    keep: roll.keep,
    diceSides: roll.dice_sides,
    diceCount: roll.dice_count,
    modifier: roll.modifier,
    resultTotal: roll.result_total,
    characterId: roll.character_id,
    monsterInstanceId: roll.monster_instance_id,
    encounterId: roll.encounter_id,
    userId: roll.user_id,
    createdAt: roll.created_at,
  };

  const room = campaignRoom(campaignId);
  if (roll.visible_to_players) {
    io.to(room).emit('DICE_ROLLED', payload);
    return;
  }
  const { dmSocketIds } = await splitSocketsByRole(io, campaignId, room);
  if (dmSocketIds.length > 0) io.to(dmSocketIds).emit('DICE_ROLLED', payload);
}

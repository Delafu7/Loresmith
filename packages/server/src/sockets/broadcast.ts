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
import type { CampaignRole } from '../services/authz.js';
import { isActionVisibleToPlayers, type CombatActionView } from '../services/combatActions.js';

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
  participants: Array<{ id: string; initiative_roll: number; initiative_tiebreak: number | null; turn_order: number }>,
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

export function broadcastParticipantJoined(
  io: Server,
  encounter: EncounterLike,
  participant: { id: string; character_id: string | null; monster_instance_id: string | null; initiative_roll: number; turn_order: number },
): void {
  io.to(encounterRoom(encounter.id)).emit('PARTICIPANT_JOINED', {
    ...envelope(encounter),
    participant: {
      participantId: participant.id,
      characterId: participant.character_id,
      monsterInstanceId: participant.monster_instance_id,
      initiativeRoll: participant.initiative_roll,
      turnOrder: participant.turn_order,
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
    backgroundAssetId: map.background_asset_id,
    backgroundFileUrl: map.background_file_url,
    gridColumns: map.grid_columns,
    gridRows: map.grid_rows,
    cellSizePx: map.cell_size_px,
    feetPerCell: map.feet_per_cell,
  });
}

export function broadcastTokenMoved(
  io: Server,
  encounter: EncounterLike,
  participant: { id: string; pos_x: number | null; pos_y: number | null },
): void {
  io.to(encounterRoom(encounter.id)).emit('TOKEN_MOVED', {
    ...envelope(encounter),
    participantId: participant.id,
    x: participant.pos_x,
    y: participant.pos_y,
  });
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

// REFACTOR-PLAN.md §3 — same no-visibility-split shape as TOKEN_MOVED above
// (faction isn't HP-sensitive info).
export function broadcastParticipantFactionChanged(
  io: Server,
  encounter: EncounterLike,
  participant: { id: string; faction: 'player' | 'ally' | 'enemy' | 'neutral' },
): void {
  io.to(encounterRoom(encounter.id)).emit('PARTICIPANT_FACTION_CHANGED', {
    ...envelope(encounter),
    participantId: participant.id,
    faction: participant.faction,
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
    id: string;
    action_used: boolean;
    bonus_action_used: boolean;
    reaction_used: boolean;
    dash_used: boolean;
    movement_used_ft: number;
    object_interaction_used: boolean;
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
    objectInteractionUsed: participant.object_interaction_used,
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
  encounter_id: string;
  campaign_id: string;
  sync_seq: number;
}

export function broadcastArmorClassChanged(
  io: Server,
  sync: ArmorClassSyncTarget,
  participant: { participantId: string; characterId: string; armorClass: number },
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

// ---- HP_CHANGED ----
//
// HP is always visible to every campaign member (the DM/player visibility
// split this event used to carry — exact/banded/hidden per participant —
// was removed along with hp_visibility; see the "remove hide/reveal" work).

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

export function broadcastHpChanged(io: Server, target: HpChangeTarget): void {
  io.to(encounterRoom(target.encounterId)).emit('HP_CHANGED', {
    encounterId: target.encounterId,
    campaignId: target.campaignId,
    seq: target.seq,
    serverTimestamp: Date.now(),
    participantId: target.participantId,
    characterId: target.characterId,
    monsterInstanceId: target.monsterInstanceId,
    changeType: target.delta > 0 ? 'heal' : target.delta < 0 ? 'damage' : 'none',
    hp: { hpCurrent: target.hpCurrent, hpMax: target.hpMax, hpTemp: target.hpTemp },
  });
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

export function broadcastEffectApplied(io: Server, sync: EffectSyncTarget, effect: EffectBroadcastRow, effectDefinitionName: string): void {
  io.to(encounterRoom(sync.encounter_id)).emit('EFFECT_APPLIED', effectPayloadBase(sync, effect, effectDefinitionName));
}

export function broadcastEffectExpired(io: Server, sync: EffectSyncTarget, effect: EffectBroadcastRow, effectDefinitionName: string): void {
  // durationRemaining is forced to 0 here regardless of the row's stored
  // duration_value — "expired" means zero remaining by definition, whether
  // it got there via the automatic per-round decrement or a DM manually
  // removing an effect early (whose duration_value may still be positive).
  const payload = { ...effectPayloadBase(sync, effect, effectDefinitionName), durationRemaining: 0 };
  io.to(encounterRoom(sync.encounter_id)).emit('EFFECT_EXPIRED', payload);
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

// HP/armor class/effect *fields* are still always-visible for any row a
// viewer can see at all (hide/reveal for those was removed; the one
// remaining redaction, monster-instance weaknesses, isn't part of this
// payload — it's read via GET /monster-instances/:id, which still redacts).
// What DOES split by role now (nav point 1): whether a participant ROW is
// present at all — a non-DM viewer never receives a hidden (visible_to_players
// = false) participant, full stop, not even a redacted stub.
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
    hp: { hpCurrent: p.hp_current, hpMax: p.hp_max, hpTemp: p.hp_temp },
    effects: (effectsByTarget.get(effectTargetKey(p.character_id, p.monster_instance_id)) ?? []).map(formatEffectForWire),
    visibleToPlayers: p.visible_to_players,
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

  return {
    encounterId: encounter.id,
    campaignId: encounter.campaign_id,
    seq: encounter.sync_seq,
    serverTimestamp: Date.now(),
    encounter: {
      status: encounter.status,
      mode: encounter.mode,
      currentRound: encounter.current_round,
      currentTurnIndex: encounter.current_turn_index,
    },
    activeParticipantId: active?.participant_id ?? null,
    participants: visibleParticipantsOut,
    map: formatMapForWire(map),
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
  created_at: Date | string;
}

export function broadcastDiceRolled(io: Server, campaignId: string, roll: DiceRollBroadcastRow): void {
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

  io.to(campaignRoom(campaignId)).emit('DICE_ROLLED', payload);
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

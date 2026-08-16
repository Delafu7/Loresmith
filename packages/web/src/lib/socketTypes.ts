// Socket.io event payload shapes, mirroring packages/server/src/sockets/broadcast.ts.
// Every broadcast carries {encounterId, campaignId, seq, serverTimestamp}.
//
// HP is the one field that does NOT carry the same shape regardless of who
// receives it (Phase 2 "restore hp_visibility + banding", reversing the
// prior "HP always visible" state for this field specifically — see
// HpForWire below and sockets/broadcast.ts's resolveHpForViewer, its
// server-side source of truth).

import type {
  ActiveEffectSummary,
  DiceRollKeep,
  DiceRollType,
  DiceRollVisibility,
  EffectDurationType,
  EncounterDisposition,
  EncounterMode,
  EncounterStatus,
  MapElementOrRedacted,
  MapLightingState,
  ParticipantHp,
  PendingActionRequest,
  ResourcePool,
} from './types';

export interface Envelope {
  encounterId: string;
  campaignId: string;
  seq: number;
  serverTimestamp: number;
}

export interface CombatStartedEvent extends Envelope {
  status: EncounterStatus;
  currentRound: number;
}

export interface CombatEndedEvent extends Envelope {
  status: EncounterStatus;
}

export interface InitiativeRolledEvent extends Envelope {
  participants: Array<{
    participantId: string;
    initiativeRoll: number;
    initiativeTiebreak: number | null;
    turnOrder: number;
  }>;
}

export interface TurnAdvancedEvent extends Envelope {
  currentRound: number;
  currentTurnIndex: number;
  activeParticipantId: string | null;
}

export interface ParticipantJoinedEvent extends Envelope {
  participant: {
    participantId: string;
    characterId: string | null;
    monsterInstanceId: string | null;
    initiativeRoll: number;
    turnOrder: number;
  };
}

export interface ParticipantLeftEvent extends Envelope {
  participant: {
    participantId: string;
    characterId: string | null;
    monsterInstanceId: string | null;
  };
}

export interface HpChangedEvent extends Envelope {
  participantId: string;
  characterId: string | null;
  monsterInstanceId: string | null;
  changeType: 'damage' | 'heal' | 'none';
  // ParticipantHp (lib/types.ts) mirrors sockets/broadcast.ts's HpForWire —
  // see that type's own doc comment for the shape/why.
  hp: ParticipantHp;
}

// Battle map (Phase 3.3) — same shape on FULL_STATE_SYNC.map, MAP_UPDATED,
// and the plain REST GET /campaigns/:id/encounters/:encounterId (camelCase
// here since this is the socket layer; that REST route uses snake_case per
// this codebase's usual split).
export interface MapConfig {
  // The library map's own id (maps.id) — lets a map-library picker tell
  // which of a campaign's maps is this encounter's currently active one.
  id: string;
  backgroundAssetId: string | null;
  backgroundFileUrl: string | null;
  gridColumns: number;
  gridRows: number;
  cellSizePx: number;
  // REFACTOR-PLAN.md §4 — movement-math ratio, distinct from cellSizePx
  // (pixel rendering size). See docs/rules/movement.md §2.1.
  feetPerCell: number;
  // Per-map lighting state (nav point 4) — not secret (never DM/player
  // split); only its rendering consequences differ by role, computed
  // client-side (VisionOverlay.tsx's masking gate + dim tint).
  lightingState: MapLightingState;
}

export interface FullStateSyncEvent extends Envelope {
  encounter: {
    status: EncounterStatus;
    mode: EncounterMode;
    disposition: EncounterDisposition;
    currentRound: number;
    currentTurnIndex: number;
  };
  activeParticipantId: string | null;
  participants: Array<{
    participantId: string;
    characterId: string | null;
    monsterInstanceId: string | null;
    name: string;
    initiativeRoll: number;
    initiativeTiebreak: number | null;
    turnOrder: number;
    hp: ParticipantHp;
    effects: ActiveEffectSummary[];
    posX: number | null;
    posY: number | null;
    armorClass: number;
    actionUsed: boolean;
    bonusActionUsed: boolean;
    reactionUsed: boolean;
    dashUsed: boolean;
    movementUsedFt: number;
    objectInteractionUsed: boolean;
    speedFt: number | null;
    monsterInstanceStatus: 'alive' | 'dead' | 'fled' | 'captured' | null;
    size: string;
    faction: 'player' | 'ally' | 'enemy' | 'neutral';
    imageUrl: string | null;
    visibleToPlayers: boolean;
    // GM-only visibility layer — derived, wire-only convenience field so
    // client code that wants a uniform `.visibility` across notes/
    // map-elements/tokens can read one here too. visibleToPlayers above
    // stays the actual mechanism (unchanged).
    visibility: 'gm_only' | 'revealed_to_players';
    legendaryActionsRemaining: number | null;
    visionEnabled: boolean;
    visionRadiusFt: number;
    darkvisionRadiusFt: number;
  }>;
  map: MapConfig | null;
  // GM-only visibility layer — server-filtered per viewer (see server's
  // buildFullStateSyncPayload): a hidden wall/door/light arrives as a
  // RedactedMapElement (geometry-only stub, needed for fog-of-war
  // raycasting / light-radius rendering); a hidden note/area/image is
  // omitted from this array entirely.
  mapElements: MapElementOrRedacted[];
}

// Phase 2 "lair actions (round-start trigger)" — room-wide, no DM/player
// split (see sockets/broadcast.ts's broadcastLairActionAvailable). Only
// fired by the advance-turn route when the round actually just advanced and
// the encounter has lair actions configured.
export interface LairActionAvailableEvent extends Envelope {
  currentRound: number;
  lairActions: Array<{ name: string; description: string }> | null;
}

// REFACTOR-PLAN.md §3 — DM override for a participant's board faction.
export interface ParticipantFactionChangedEvent extends Envelope {
  participantId: string;
  faction: 'player' | 'ally' | 'enemy' | 'neutral';
}

// DM battle-map vision feature — same "no visibility split" reasoning as
// PARTICIPANT_FACTION_CHANGED.
export interface ParticipantVisionChangedEvent extends Envelope {
  participantId: string;
  visionEnabled: boolean;
  visionRadiusFt: number;
  darkvisionRadiusFt: number;
}

// No DM/player visibility split on either event (see sockets/broadcast.ts) —
// map config and token position aren't HP-sensitive.
export interface MapUpdatedEvent extends Envelope, MapConfig {}

export interface TokenMovedEvent extends Envelope {
  participantId: string;
  x: number | null;
  y: number | null;
  // Same value setParticipantPosition charges atomically alongside pos_x/
  // pos_y server-side — carried here so a client's movementRemaining display
  // (Token.tsx's drag-preview label, ActionEconomyPanel) doesn't go stale
  // between this move and the next ACTION_ECONOMY_CHANGED/FULL_STATE_SYNC.
  movementUsedFt: number;
}

// Elements are scoped to CampaignMap.id, not one encounter (see
// services/mapElements.ts's header comment) — every encounter linked to the
// affected map gets its own broadcast. GM-only visibility layer — role-split
// server-side (see sockets/broadcast.ts's broadcastMapElementsChanged): a
// non-DM viewer's `element` is either the full shape, a RedactedMapElement
// stub for a hidden wall/door/light, or this event simply never arrives for
// a fully-hidden element (e.g. a gm_only note). 'deleted' has no row left to
// send, just the id (safe to send unconditionally — deleting something a
// player never knew existed reveals nothing).
export interface MapElementsChangedEvent extends Envelope {
  changeType: 'created' | 'updated' | 'deleted';
  element: MapElementOrRedacted | { id: string };
}

// Exploration/combat mode toggle — the one genuinely new event this feature
// needs (see sockets/broadcast.ts's broadcastModeChanged). No visibility
// split, same as MAP_UPDATED/TOKEN_MOVED.
export interface ModeChangedEvent extends Envelope {
  mode: EncounterMode;
}

// DISPOSITION_CHANGED — encounter-level friendly/neutral/hostile/unknown
// transition (distinct from PARTICIPANT_FACTION_CHANGED above, which is
// per-participant board-coloring, not "is this scene a fight"). Carries the
// full history event so a receiving client can append to a disposition
// history list without a follow-up fetch, same reasoning as
// ActionRecordedEvent below. No visibility split — disposition isn't
// HP-sensitive info, same as MODE_CHANGED/TOKEN_MOVED.
export interface DispositionChangedEvent extends Envelope {
  disposition: EncounterDisposition;
  event: {
    id: string;
    fromDisposition: EncounterDisposition;
    toDisposition: EncounterDisposition;
    changedByUserId: string;
    note: string | null;
    createdAt: string;
  };
}

// Phase 3.5 — fires only for CHARACTER participants (never monster
// instances, which use a flat DM-set armor_class_override with no
// auto-recompute path) when armor_class_mode='auto' and an equip toggle (or
// a dex change) recomputes AC while the character is a live
// combat_participants row. No DM/player visibility split (AC isn't
// HP-sensitive), same as TOKEN_MOVED/MAP_UPDATED above.
export interface ParticipantAcChangedEvent extends Envelope {
  participantId: string;
  characterId: string;
  armorClass: number;
}

// Phase 3.6 — no DM/player visibility split, same reasoning as
// TOKEN_MOVED/MAP_UPDATED above (action-economy state isn't HP-sensitive).
export interface ActionEconomyChangedEvent extends Envelope {
  participantId: string;
  actionUsed: boolean;
  bonusActionUsed: boolean;
  reactionUsed: boolean;
  dashUsed: boolean;
  movementUsedFt: number;
  objectInteractionUsed: boolean;
}

// EFFECT_APPLIED/EFFECT_EXPIRED (sockets/broadcast.ts's effectPayloadBase) —
// `targetId`/`targetType` identify the character/monster-instance the effect
// is ON, NOT the combat_participants row, since the same active_effects row
// can be applied outside combat (see routes/characters.ts,
// routes/monsters.ts's POST .../effects) and still need to reach a live
// encounter room the target happens to be a participant in.
export interface EffectAppliedEvent extends Envelope {
  effectId: string;
  targetId: string;
  targetType: 'character' | 'monster_instance';
  effectDefinitionId: string;
  name: string;
  durationType: EffectDurationType;
  durationRemaining: number | null;
  concentration: boolean;
  sourceCharacterId: string | null;
}

export type EffectExpiredEvent = EffectAppliedEvent;

// CONCENTRATION_CHECK_PROMPTED (Phase 2) — deliberately does NOT extend
// Envelope: it's a targeted event (DM + the concentrating character's
// controller only, see sockets/broadcast.ts's broadcastConcentrationCheckPrompted),
// not something every connected socket receives, so there's no `seq` for
// FULL_STATE_SYNC gap-checking to apply to — same reasoning DiceRolledEvent
// already uses for the same shape of event.
export interface ConcentrationCheckPromptedEvent {
  encounterId: string;
  campaignId: string;
  serverTimestamp: number;
  characterId: string | null;
  monsterInstanceId: string | null;
  effectId: string;
  effectDefinitionId: string;
  effectName: string;
  dc: number;
  damage: number;
}

// REVEAL_CHANGED — the one surviving DM/player redaction split: a monster
// instance's damage vulnerabilities/resistances/immunities can be
// individually hidden/revealed. One event per field per PATCH, same "not
// batched" reasoning as EFFECT_APPLIED/EFFECT_EXPIRED above. `value` is
// already fully resolved server-side for this socket's role (true value for
// DM, override-or-true-value for a revealed player, null for a still-hidden
// one) — never branch on `revealed` client-side to decide what to render,
// just render `value` as-is.
export interface RevealChangedEvent extends Envelope {
  participantId: string;
  monsterInstanceId: string;
  fieldKey: string;
  revealed: boolean;
  value: unknown;
}

// DICE_ROLLED (Phase 3.4) — deliberately does NOT extend `Envelope`: a dice
// roll isn't part of any encounter's turn-sequencing state, so there's no
// `seq` at all (this event is not routed through useEncounterLive.ts's
// withSeqCheck/FULL_STATE_SYNC machinery — treat it as a fully separate,
// simpler subscription), and `encounterId` is optional here since rolls can
// happen outside combat, unlike every event above where it's guaranteed.
// No `visibleToPlayers` field: server-side filtering already ensures this
// event only reaches a socket that's allowed to see the roll, so nothing to
// branch on client-side.
export interface DiceRolledEvent {
  masked: false;
  campaignId: string;
  serverTimestamp: number;
  id: string;
  rollType: DiceRollType;
  rollContext: string | null;
  d20Rolls: number[];
  keep: DiceRollKeep;
  diceSides: number;
  diceCount: number;
  modifier: number;
  resultTotal: number;
  isCritical: boolean;
  visibility: DiceRollVisibility;
  isManual: boolean;
  characterId: string | null;
  monsterInstanceId: string | null;
  encounterId: string | null;
  userId: string;
  createdAt: string;
}

// Phase 2 "hidden rolls record occurrence" — sent instead of DiceRolledEvent
// (same event name, discriminated by `masked`) to a socket that isn't
// allowed to see a gm_only/private roll's value: id/roller/context/type
// present, every result-bearing field simply absent, so a hidden roll is at
// least visible as "something happened" rather than invisible.
export interface DiceRollMaskedEvent {
  masked: true;
  campaignId: string;
  serverTimestamp: number;
  id: string;
  rollType: DiceRollType;
  rollContext: string | null;
  visibility: DiceRollVisibility;
  characterId: string | null;
  monsterInstanceId: string | null;
  encounterId: string | null;
  userId: string;
  createdAt: string;
}

// Void, not delete (Iteration 3 §2.4) — same recipient set as the DICE_ROLLED
// this roll originally went to, so voiding never leaks that a
// gm_only/private roll existed to someone who couldn't already see it.
export interface DiceRollVoidedEvent {
  campaignId: string;
  serverTimestamp: number;
  id: string;
}

// Iteration 3 minor sweep — spending/recovering a resource pool used to
// broadcast nothing at all; a same-player-two-tabs (or delegated-controller
// + owner) view went stale. Campaign-room, not encounter-room — resource
// pools can change outside combat too (rests, out-of-combat casting).
export interface ResourcePoolChangedEvent {
  campaignId: string;
  serverTimestamp: number;
  characterId: string;
  resource: ResourcePool;
}

// Roll requests (Iteration 3 §2.3) — room-wide; never carries a roll's
// value, only request/target metadata (see broadcast.ts's own comment on
// why this is safe to fan out room-wide unlike DICE_ROLLED).
export interface DiceRollRequestedEvent {
  campaignId: string;
  serverTimestamp: number;
  id: string;
  rollType: DiceRollType;
  rollContext: string | null;
  dc: number | null;
  encounterId: string | null;
  targetUserIds: string[];
}

export interface DiceRollRequestUpdatedEvent {
  campaignId: string;
  serverTimestamp: number;
  targetId: string;
  requestId: string;
  status: 'pending' | 'rolled' | 'passed';
  diceRollId: string | null;
}

// ACTION_RECORDED (nav point 2 — combat log). Same "not part of turn-
// sequencing, no seq" shape as DICE_ROLLED just above: a missed event only
// leaves the combat log panel one line behind until its next paginated
// fetch. No visibleToPlayers field for the same reason as DICE_ROLLED —
// server-side role-split (broadcastActionRecorded) already ensures this only
// reaches a socket allowed to see it.
export interface CombatActionTargetWire {
  characterId: string | null;
  monsterInstanceId: string | null;
  name: string;
}

export interface CombatActionWire {
  id: string;
  encounterId: string;
  actorCharacterId: string | null;
  actorMonsterInstanceId: string | null;
  actorName: string;
  actionType: string;
  meansName: string | null;
  diceRollId: string | null;
  diceRollTotal: number | null;
  resultKind: string;
  damageAmount: number | null;
  damageTypeName: string | null;
  effectDescription: string | null;
  createdAt: string;
  targets: CombatActionTargetWire[];
}

export interface ActionRecordedEvent {
  encounterId: string;
  campaignId: string;
  serverTimestamp: number;
  action: CombatActionWire;
}

// ENCOUNTER_OPENED / ENCOUNTER_FULLSCREEN_FORCED (map-first encounter
// system) — same "not part of turn-sequencing, no seq" shape as DICE_ROLLED/
// ACTION_RECORDED: this is a one-shot navigation nudge, not sync-critical
// state. Server targets these at exactly the sockets that should act on
// them (sockets/broadcast.ts's relevantSocketIds), so every socket that
// receives one is, by construction, relevant — no client-side filtering
// needed beyond "have I already minimized this specific encounter" (respect
// that for ENCOUNTER_OPENED, override it for ENCOUNTER_FULLSCREEN_FORCED).
export interface EncounterOpenedEvent {
  encounterId: string;
  campaignId: string;
  name: string;
  serverTimestamp: number;
}

// BESTIARY_UPDATED (Task 1 — per-campaign bestiary) — a bare invalidation
// signal, same "not part of turn-sequencing, no seq" shape as DICE_ROLLED:
// carries no entry data (a role-correct payload can't be computed once for
// both DM and player sockets without risking an undiscovered creature
// leaking), so a receiving client just refetches GET /campaigns/:id/bestiary.
export interface BestiaryUpdatedEvent {
  campaignId: string;
  serverTimestamp: number;
}

// LOCATIONS_FACTIONS_UPDATED — DM hide/reveal for locations/factions. Same
// bare-invalidation-signal shape as BESTIARY_UPDATED above: carries no row
// data, just which of the two shared-UI tabs (LocationsFactionsPage.tsx)
// changed, so a receiving client refetches the already-role-filtered
// GET /campaigns/:id/locations|factions.
export interface LocationsFactionsUpdatedEvent {
  campaignId: string;
  kind: 'locations' | 'factions';
  serverTimestamp: number;
}

// CHARACTERS_UPDATED — DM hide/reveal for NPCs. Same bare-invalidation-signal
// shape as BESTIARY_UPDATED/LOCATIONS_FACTIONS_UPDATED: carries no row data,
// so a receiving client refetches the already-role-filtered
// GET /campaigns/:id/characters.
export interface CharactersUpdatedEvent {
  campaignId: string;
  serverTimestamp: number;
}

// PENDING_ACTION_CREATED / PENDING_ACTION_RESOLVED (Phase 4 "DM approval
// before a player-submitted action resolves") — same "not part of turn-
// sequencing, no seq" shape as DICE_ROLLED/ACTION_RECORDED: a missed event
// just leaves the DM's review queue or the player's own submission status
// one refetch behind. Server targets these at exactly the DM's sockets plus
// the requesting player's own sockets (sockets/broadcast.ts's
// broadcastPendingActionCreated/Resolved) — never room-wide, unlike
// ACTION_RECORDED, since another player has no business seeing someone
// else's in-flight or resolved request.
export interface PendingActionCreatedEvent {
  encounterId: string;
  campaignId: string;
  serverTimestamp: number;
  request: PendingActionRequest;
}

export interface PendingActionResolvedEvent {
  encounterId: string;
  campaignId: string;
  serverTimestamp: number;
  request: PendingActionRequest;
}

export interface ServerToClientEvents {
  COMBAT_STARTED: (payload: CombatStartedEvent) => void;
  COMBAT_ENDED: (payload: CombatEndedEvent) => void;
  INITIATIVE_ROLLED: (payload: InitiativeRolledEvent) => void;
  TURN_ADVANCED: (payload: TurnAdvancedEvent) => void;
  PARTICIPANT_JOINED: (payload: ParticipantJoinedEvent) => void;
  PARTICIPANT_LEFT: (payload: ParticipantLeftEvent) => void;
  HP_CHANGED: (payload: HpChangedEvent) => void;
  EFFECT_APPLIED: (payload: EffectAppliedEvent) => void;
  EFFECT_EXPIRED: (payload: EffectExpiredEvent) => void;
  CONCENTRATION_CHECK_PROMPTED: (payload: ConcentrationCheckPromptedEvent) => void;
  LAIR_ACTION_AVAILABLE: (payload: LairActionAvailableEvent) => void;
  REVEAL_CHANGED: (payload: RevealChangedEvent) => void;
  FULL_STATE_SYNC: (payload: FullStateSyncEvent) => void;
  // GM-only visibility layer — "view as player" preview (DM-only request,
  // see sockets/rooms.ts's request:sync-preview). Reuses the exact same
  // FullStateSyncEvent shape, forced to role='player' server-side — a
  // point-in-time snapshot, not a second live-patched stream (see
  // useEncounterLive.ts).
  FULL_STATE_SYNC_PREVIEW: (payload: FullStateSyncEvent) => void;
  MAP_UPDATED: (payload: MapUpdatedEvent) => void;
  MAP_ELEMENTS_CHANGED: (payload: MapElementsChangedEvent) => void;
  TOKEN_MOVED: (payload: TokenMovedEvent) => void;
  MODE_CHANGED: (payload: ModeChangedEvent) => void;
  DISPOSITION_CHANGED: (payload: DispositionChangedEvent) => void;
  PARTICIPANT_AC_CHANGED: (payload: ParticipantAcChangedEvent) => void;
  PARTICIPANT_FACTION_CHANGED: (payload: ParticipantFactionChangedEvent) => void;
  PARTICIPANT_VISION_CHANGED: (payload: ParticipantVisionChangedEvent) => void;
  ACTION_ECONOMY_CHANGED: (payload: ActionEconomyChangedEvent) => void;
  DICE_ROLLED: (payload: DiceRolledEvent | DiceRollMaskedEvent) => void;
  DICE_ROLL_VOIDED: (payload: DiceRollVoidedEvent) => void;
  DICE_ROLL_REQUESTED: (payload: DiceRollRequestedEvent) => void;
  DICE_ROLL_REQUEST_UPDATED: (payload: DiceRollRequestUpdatedEvent) => void;
  RESOURCE_POOL_CHANGED: (payload: ResourcePoolChangedEvent) => void;
  ACTION_RECORDED: (payload: ActionRecordedEvent) => void;
  ENCOUNTER_OPENED: (payload: EncounterOpenedEvent) => void;
  ENCOUNTER_FULLSCREEN_FORCED: (payload: EncounterOpenedEvent) => void;
  BESTIARY_UPDATED: (payload: BestiaryUpdatedEvent) => void;
  LOCATIONS_FACTIONS_UPDATED: (payload: LocationsFactionsUpdatedEvent) => void;
  CHARACTERS_UPDATED: (payload: CharactersUpdatedEvent) => void;
  PENDING_ACTION_CREATED: (payload: PendingActionCreatedEvent) => void;
  PENDING_ACTION_RESOLVED: (payload: PendingActionResolvedEvent) => void;
}

export interface AckOk {
  ok: true;
  [key: string]: unknown;
}
export interface AckErr {
  ok: false;
  error: { code: string; message: string };
}
export type Ack = AckOk | AckErr;

export interface ClientToServerEvents {
  'join:campaign': (payload: { campaignId: string }, ack?: (res: Ack) => void) => void;
  'join:encounter': (payload: { encounterId: string }, ack?: (res: Ack) => void) => void;
  'request:sync': (payload: { encounterId: string }, ack?: (res: Ack) => void) => void;
  // GM-only visibility layer — "view as player" preview, DM-only server-side.
  'request:sync-preview': (payload: { encounterId: string }, ack?: (res: Ack) => void) => void;
}

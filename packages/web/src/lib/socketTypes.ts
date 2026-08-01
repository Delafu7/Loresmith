// Socket.io event payload shapes, mirroring packages/server/src/sockets/broadcast.ts.
// Every broadcast carries {encounterId, campaignId, seq, serverTimestamp}. HP is
// always visible to every role now (hide/reveal was removed) — every event
// carries the same exact `hp` shape regardless of who receives it.

import type {
  ActiveEffectSummary,
  DiceRollKeep,
  DiceRollType,
  EffectDurationType,
  EncounterMode,
  EncounterStatus,
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
  hp: { hpCurrent: number; hpMax: number; hpTemp: number };
}

// Battle map (Phase 3.3) — same shape on FULL_STATE_SYNC.map, MAP_UPDATED,
// and the plain REST GET /campaigns/:id/encounters/:encounterId (camelCase
// here since this is the socket layer; that REST route uses snake_case per
// this codebase's usual split).
export interface MapConfig {
  backgroundAssetId: string | null;
  backgroundFileUrl: string | null;
  gridColumns: number;
  gridRows: number;
  cellSizePx: number;
  // REFACTOR-PLAN.md §4 — movement-math ratio, distinct from cellSizePx
  // (pixel rendering size). See docs/rules/movement.md §2.1.
  feetPerCell: number;
}

export interface FullStateSyncEvent extends Envelope {
  encounter: {
    status: EncounterStatus;
    mode: EncounterMode;
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
    hp: { hpCurrent: number; hpMax: number; hpTemp: number };
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
  }>;
  map: MapConfig | null;
}

// REFACTOR-PLAN.md §3 — DM override for a participant's board faction.
export interface ParticipantFactionChangedEvent extends Envelope {
  participantId: string;
  faction: 'player' | 'ally' | 'enemy' | 'neutral';
}

// No DM/player visibility split on either event (see sockets/broadcast.ts) —
// map config and token position aren't HP-sensitive.
export interface MapUpdatedEvent extends Envelope, MapConfig {}

export interface TokenMovedEvent extends Envelope {
  participantId: string;
  x: number | null;
  y: number | null;
}

// Exploration/combat mode toggle — the one genuinely new event this feature
// needs (see sockets/broadcast.ts's broadcastModeChanged). No visibility
// split, same as MAP_UPDATED/TOKEN_MOVED.
export interface ModeChangedEvent extends Envelope {
  mode: EncounterMode;
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
  characterId: string | null;
  monsterInstanceId: string | null;
  encounterId: string | null;
  userId: string;
  createdAt: string;
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
  REVEAL_CHANGED: (payload: RevealChangedEvent) => void;
  FULL_STATE_SYNC: (payload: FullStateSyncEvent) => void;
  MAP_UPDATED: (payload: MapUpdatedEvent) => void;
  TOKEN_MOVED: (payload: TokenMovedEvent) => void;
  MODE_CHANGED: (payload: ModeChangedEvent) => void;
  PARTICIPANT_AC_CHANGED: (payload: ParticipantAcChangedEvent) => void;
  PARTICIPANT_FACTION_CHANGED: (payload: ParticipantFactionChangedEvent) => void;
  ACTION_ECONOMY_CHANGED: (payload: ActionEconomyChangedEvent) => void;
  DICE_ROLLED: (payload: DiceRolledEvent) => void;
  ACTION_RECORDED: (payload: ActionRecordedEvent) => void;
  ENCOUNTER_OPENED: (payload: EncounterOpenedEvent) => void;
  ENCOUNTER_FULLSCREEN_FORCED: (payload: EncounterOpenedEvent) => void;
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
}

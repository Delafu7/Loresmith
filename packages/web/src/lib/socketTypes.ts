// Socket.io event payload shapes, mirroring packages/server/src/sockets/broadcast.ts.
// Every broadcast carries {encounterId, campaignId, seq, serverTimestamp}; HP_CHANGED
// is the one event with a per-connection visibility split (exact vs banded/hidden),
// decided server-side — the client only ever renders whichever `hp` shape arrives.

import type {
  ActiveEffectSummary,
  DiceRollKeep,
  DiceRollType,
  EffectDurationType,
  HpBand,
  HpVisibility,
  EncounterStatus,
} from './types';

export interface Envelope {
  encounterId: number;
  campaignId: number;
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
    participantId: number;
    initiativeRoll: number;
    initiativeTiebreak: number | null;
    turnOrder: number;
  }>;
}

export interface TurnAdvancedEvent extends Envelope {
  currentRound: number;
  currentTurnIndex: number;
  activeParticipantId: number | null;
}

export interface ParticipantJoinedEvent extends Envelope {
  participant: {
    participantId: number;
    characterId: number | null;
    monsterInstanceId: number | null;
    initiativeRoll: number;
    turnOrder: number;
    hpVisibility: HpVisibility;
  };
}

export interface ParticipantLeftEvent extends Envelope {
  participant: {
    participantId: number;
    characterId: number | null;
    monsterInstanceId: number | null;
  };
}

export interface HpChangedEvent extends Envelope {
  participantId: number;
  characterId: number | null;
  monsterInstanceId: number | null;
  changeType: 'damage' | 'heal' | 'none';
  hp: { hpCurrent: number; hpMax: number; hpTemp: number } | { band: HpBand };
}

// Battle map (Phase 3.3) — same shape on FULL_STATE_SYNC.map, MAP_UPDATED,
// and the plain REST GET /campaigns/:id/encounters/:encounterId (camelCase
// here since this is the socket layer; that REST route uses snake_case per
// this codebase's usual split).
export interface MapConfig {
  backgroundAssetId: number | null;
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
    currentRound: number;
    currentTurnIndex: number;
  };
  activeParticipantId: number | null;
  participants: Array<{
    participantId: number;
    characterId: number | null;
    monsterInstanceId: number | null;
    name: string;
    initiativeRoll: number;
    initiativeTiebreak: number | null;
    turnOrder: number;
    hpVisibility: HpVisibility;
    hp: { hpCurrent: number; hpMax: number; hpTemp: number } | { band: HpBand };
    effects: ActiveEffectSummary[];
    posX: number | null;
    posY: number | null;
    // null for a non-PC participant whose armorClass reveal isn't currently
    // revealed to this socket's role (PLAN.md §11.6) — PCs are always the
    // true value, same exemption HP redaction already gives them.
    armorClass: number | null;
    actionUsed: boolean;
    bonusActionUsed: boolean;
    reactionUsed: boolean;
    dashUsed: boolean;
    movementUsedFt: number;
    speedFt: number | null;
    monsterInstanceStatus: 'alive' | 'dead' | 'fled' | 'captured' | null;
    size: string;
    faction: 'player' | 'ally' | 'enemy' | 'neutral';
  }>;
  map: MapConfig | null;
}

// REFACTOR-PLAN.md §3 — DM override for a participant's board faction.
export interface ParticipantFactionChangedEvent extends Envelope {
  participantId: number;
  faction: 'player' | 'ally' | 'enemy' | 'neutral';
}

// No DM/player visibility split on either event (see sockets/broadcast.ts) —
// map config and token position aren't HP-sensitive.
export interface MapUpdatedEvent extends Envelope, MapConfig {}

export interface TokenMovedEvent extends Envelope {
  participantId: number;
  x: number | null;
  y: number | null;
}

// Phase 3.5 — fires only for CHARACTER participants (never monster
// instances, which use a flat DM-set armor_class_override with no
// auto-recompute path) when armor_class_mode='auto' and an equip toggle (or
// a dex change) recomputes AC while the character is a live
// combat_participants row. No DM/player visibility split (AC isn't
// HP-sensitive), same as TOKEN_MOVED/MAP_UPDATED above.
export interface ParticipantAcChangedEvent extends Envelope {
  participantId: number;
  characterId: number;
  armorClass: number;
}

// Phase 3.6 — no DM/player visibility split, same reasoning as
// TOKEN_MOVED/MAP_UPDATED above (action-economy state isn't HP-sensitive).
export interface ActionEconomyChangedEvent extends Envelope {
  participantId: number;
  actionUsed: boolean;
  bonusActionUsed: boolean;
  reactionUsed: boolean;
  dashUsed: boolean;
  movementUsedFt: number;
}

// EFFECT_APPLIED/EFFECT_EXPIRED (sockets/broadcast.ts's effectPayloadBase) —
// `targetId`/`targetType` identify the character/monster-instance the effect
// is ON, NOT the combat_participants row, since the same active_effects row
// can be applied outside combat (see routes/characters.ts,
// routes/monsters.ts's POST .../effects) and still need to reach a live
// encounter room the target happens to be a participant in.
export interface EffectAppliedEvent extends Envelope {
  effectId: number;
  targetId: number;
  targetType: 'character' | 'monster_instance';
  effectDefinitionId: number;
  name: string;
  durationType: EffectDurationType;
  durationRemaining: number | null;
  concentration: boolean;
  sourceCharacterId: number | null;
}

export type EffectExpiredEvent = EffectAppliedEvent;

// REVEAL_CHANGED (PLAN.md §11.6) — one event per field per encounter sync,
// same "not batched" reasoning as EFFECT_APPLIED/EFFECT_EXPIRED above.
// `value` is already fully resolved server-side for this socket's role
// (true value for DM, override-or-true-value for a revealed player, null
// for a still-hidden one) — never branch on `revealed` client-side to
// decide what to render, just render `value` as-is.
export interface RevealChangedEvent extends Envelope {
  participantId: number;
  characterId: number | null;
  monsterInstanceId: number | null;
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
  campaignId: number;
  serverTimestamp: number;
  id: number;
  rollType: DiceRollType;
  rollContext: string | null;
  d20Rolls: number[];
  keep: DiceRollKeep;
  diceSides: number;
  diceCount: number;
  modifier: number;
  resultTotal: number;
  characterId: number | null;
  monsterInstanceId: number | null;
  encounterId: number | null;
  userId: number;
  createdAt: string;
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
  PARTICIPANT_AC_CHANGED: (payload: ParticipantAcChangedEvent) => void;
  PARTICIPANT_FACTION_CHANGED: (payload: ParticipantFactionChangedEvent) => void;
  ACTION_ECONOMY_CHANGED: (payload: ActionEconomyChangedEvent) => void;
  DICE_ROLLED: (payload: DiceRolledEvent) => void;
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
  'join:campaign': (payload: { campaignId: number }, ack?: (res: Ack) => void) => void;
  'join:encounter': (payload: { encounterId: number }, ack?: (res: Ack) => void) => void;
  'request:sync': (payload: { encounterId: number }, ack?: (res: Ack) => void) => void;
}

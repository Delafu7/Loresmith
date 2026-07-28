// Real-time reconciliation for the combat tracker (PLAN.md §6.3, §5.5).
// TanStack Query holds the ground-truth cache entry at ['encounterLive', id];
// socket events patch it directly via queryClient.setQueryData rather than
// invalidating (a refetch would visibly lag behind combat). FULL_STATE_SYNC
// is always trusted wholesale (no merge). A seq gap — or a fresh
// join/reconnect — falls back to requesting a new FULL_STATE_SYNC.

import { useEffect, useRef } from 'react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useSocket } from '../lib/SocketContext';
import type {
  ActionEconomyChangedEvent,
  CombatStartedEvent,
  CombatEndedEvent,
  EffectAppliedEvent,
  EffectExpiredEvent,
  FullStateSyncEvent,
  HpChangedEvent,
  InitiativeRolledEvent,
  MapConfig,
  MapUpdatedEvent,
  ParticipantAcChangedEvent,
  ParticipantFactionChangedEvent,
  ParticipantJoinedEvent,
  ParticipantLeftEvent,
  TokenMovedEvent,
  TurnAdvancedEvent,
} from '../lib/socketTypes';
import type { EncounterStatus, ParticipantHp, SnapshotParticipant } from '../lib/types';

export interface EncounterLiveState {
  seq: number;
  encounter: {
    status: EncounterStatus;
    currentRound: number;
    currentTurnIndex: number;
  };
  activeParticipantId: string | null;
  participants: SnapshotParticipant[];
  map: MapConfig | null;
}

function liveQueryKey(encounterId: string) {
  return ['encounterLive', encounterId] as const;
}

export function useEncounterLive(encounterId: string | undefined) {
  const queryClient = useQueryClient();
  const { socket, connected } = useSocket();
  const lastSeqRef = useRef<number | null>(null);

  const query = useQuery<EncounterLiveState | null>({
    queryKey: encounterId ? liveQueryKey(encounterId) : ['encounterLive', 'none'],
    queryFn: () => null, // never actually fetched — populated entirely by socket events
    enabled: false,
    initialData: null,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (!encounterId || !connected) return;

    function requestSync() {
      socket.emit('request:sync', { encounterId: encounterId! });
    }

    function joinAndSync() {
      socket.emit('join:encounter', { encounterId: encounterId! }, (ack) => {
        // join:encounter already triggers a server-pushed FULL_STATE_SYNC on
        // success; on failure (e.g. player has no participant in this
        // encounter yet), leave the cache empty rather than throwing.
        if (!ack.ok) {
          lastSeqRef.current = null;
        }
      });
    }

    function setFullState(payload: FullStateSyncEvent) {
      lastSeqRef.current = payload.seq;
      queryClient.setQueryData<EncounterLiveState>(liveQueryKey(encounterId!), {
        seq: payload.seq,
        encounter: payload.encounter,
        activeParticipantId: payload.activeParticipantId,
        participants: payload.participants,
        map: payload.map,
      });
    }

    // Applies a patch only if `seq` is exactly one past the last-seen value;
    // otherwise a broadcast was missed, so fall back to a full resync
    // (PLAN.md §5.5's "no merge, no replay of missed events").
    function withSeqCheck(seq: number, apply: () => void) {
      if (lastSeqRef.current !== null && seq !== lastSeqRef.current + 1) {
        requestSync();
        return;
      }
      lastSeqRef.current = seq;
      apply();
    }

    function patch(updater: (prev: EncounterLiveState) => EncounterLiveState) {
      queryClient.setQueryData<EncounterLiveState | null>(liveQueryKey(encounterId!), (prev) =>
        prev ? updater(prev) : prev,
      );
    }

    function onCombatStarted(payload: CombatStartedEvent) {
      if (payload.encounterId !== encounterId) return;
      withSeqCheck(payload.seq, () => {
        patch((prev) => ({
          ...prev,
          seq: payload.seq,
          encounter: { ...prev.encounter, status: payload.status, currentRound: payload.currentRound },
        }));
      });
    }

    function onCombatEnded(payload: CombatEndedEvent) {
      if (payload.encounterId !== encounterId) return;
      withSeqCheck(payload.seq, () => {
        patch((prev) => ({ ...prev, seq: payload.seq, encounter: { ...prev.encounter, status: payload.status } }));
      });
    }

    function onInitiativeRolled(payload: InitiativeRolledEvent) {
      if (payload.encounterId !== encounterId) return;
      withSeqCheck(payload.seq, () => {
        patch((prev) => {
          const byId = new Map(payload.participants.map((p) => [p.participantId, p]));
          const participants = prev.participants
            .map((p) => {
              const update = byId.get(p.participantId);
              if (!update) return p;
              return {
                ...p,
                initiativeRoll: update.initiativeRoll,
                initiativeTiebreak: update.initiativeTiebreak,
                turnOrder: update.turnOrder,
              };
            })
            .sort((a, b) => a.turnOrder - b.turnOrder);
          return { ...prev, seq: payload.seq, participants };
        });
      });
    }

    function onTurnAdvanced(payload: TurnAdvancedEvent) {
      if (payload.encounterId !== encounterId) return;
      withSeqCheck(payload.seq, () => {
        patch((prev) => ({
          ...prev,
          seq: payload.seq,
          encounter: {
            ...prev.encounter,
            currentRound: payload.currentRound,
            currentTurnIndex: payload.currentTurnIndex,
          },
          activeParticipantId: payload.activeParticipantId,
          // advanceTurn resets the newly-active participant's action economy
          // server-side in the same transaction as the turn move itself (see
          // services/encounters.ts) — mirrored here rather than waiting on a
          // separate event, since TURN_ADVANCED's seq bump already covers it.
          participants: prev.participants.map((p) =>
            p.participantId === payload.activeParticipantId
              ? {
                  ...p,
                  actionUsed: false,
                  bonusActionUsed: false,
                  reactionUsed: false,
                  dashUsed: false,
                  movementUsedFt: 0,
                  objectInteractionUsed: false,
                }
              : p,
          ),
        }));
      });
    }

    function onActionEconomyChanged(payload: ActionEconomyChangedEvent) {
      if (payload.encounterId !== encounterId) return;
      withSeqCheck(payload.seq, () => {
        patch((prev) => ({
          ...prev,
          seq: payload.seq,
          participants: prev.participants.map((p) =>
            p.participantId === payload.participantId
              ? {
                  ...p,
                  actionUsed: payload.actionUsed,
                  bonusActionUsed: payload.bonusActionUsed,
                  reactionUsed: payload.reactionUsed,
                  dashUsed: payload.dashUsed,
                  movementUsedFt: payload.movementUsedFt,
                  objectInteractionUsed: payload.objectInteractionUsed,
                }
              : p,
          ),
        }));
      });
    }

    // PARTICIPANT_JOINED/LEFT payloads don't carry a display name (see
    // sockets/broadcast.ts), so there's nothing clean to patch in-place —
    // request a full resync rather than inserting a partial row.
    function onParticipantJoined(payload: ParticipantJoinedEvent) {
      if (payload.encounterId !== encounterId) return;
      requestSync();
    }
    function onParticipantLeft(payload: ParticipantLeftEvent) {
      if (payload.encounterId !== encounterId) return;
      requestSync();
    }

    function onHpChanged(payload: HpChangedEvent) {
      if (payload.encounterId !== encounterId) return;
      withSeqCheck(payload.seq, () => {
        patch((prev) => ({
          ...prev,
          seq: payload.seq,
          participants: prev.participants.map((p) =>
            p.participantId === payload.participantId ? { ...p, hp: payload.hp as ParticipantHp } : p,
          ),
        }));
      });
    }

    // EFFECT_APPLIED/EFFECT_EXPIRED identify their target by
    // characterId/monsterInstanceId (targetId/targetType), not by
    // participantId — an effect applied via the outside-combat
    // /characters/:id/effects endpoint still needs to reach whichever
    // participant row(s) here happen to reference that same character (see
    // sockets/broadcast.ts's effectPayloadBase).
    function participantMatchesTarget(p: SnapshotParticipant, payload: EffectAppliedEvent): boolean {
      return payload.targetType === 'character'
        ? p.characterId === payload.targetId
        : p.monsterInstanceId === payload.targetId;
    }

    function onEffectApplied(payload: EffectAppliedEvent) {
      if (payload.encounterId !== encounterId) return;
      withSeqCheck(payload.seq, () => {
        patch((prev) => ({
          ...prev,
          seq: payload.seq,
          participants: prev.participants.map((p) => {
            if (!participantMatchesTarget(p, payload)) return p;
            if (p.effects.some((e) => e.effectId === payload.effectId)) return p; // already applied (dedup)
            return {
              ...p,
              effects: [
                ...p.effects,
                {
                  effectId: payload.effectId,
                  effectDefinitionId: payload.effectDefinitionId,
                  name: payload.name,
                  durationType: payload.durationType,
                  durationRemaining: payload.durationRemaining,
                  concentration: payload.concentration,
                  sourceCharacterId: payload.sourceCharacterId,
                },
              ],
            };
          }),
        }));
      });
    }

    function onEffectExpired(payload: EffectExpiredEvent) {
      if (payload.encounterId !== encounterId) return;
      withSeqCheck(payload.seq, () => {
        patch((prev) => ({
          ...prev,
          seq: payload.seq,
          participants: prev.participants.map((p) =>
            participantMatchesTarget(p, payload)
              ? { ...p, effects: p.effects.filter((e) => e.effectId !== payload.effectId) }
              : p,
          ),
        }));
      });
    }

    function onMapUpdated(payload: MapUpdatedEvent) {
      if (payload.encounterId !== encounterId) return;
      withSeqCheck(payload.seq, () => {
        patch((prev) => ({
          ...prev,
          seq: payload.seq,
          map: {
            backgroundAssetId: payload.backgroundAssetId,
            backgroundFileUrl: payload.backgroundFileUrl,
            gridColumns: payload.gridColumns,
            gridRows: payload.gridRows,
            cellSizePx: payload.cellSizePx,
            feetPerCell: payload.feetPerCell,
          },
        }));
      });
    }

    function onTokenMoved(payload: TokenMovedEvent) {
      if (payload.encounterId !== encounterId) return;
      withSeqCheck(payload.seq, () => {
        patch((prev) => ({
          ...prev,
          seq: payload.seq,
          participants: prev.participants.map((p) =>
            p.participantId === payload.participantId ? { ...p, posX: payload.x, posY: payload.y } : p,
          ),
        }));
      });
    }

    function onParticipantFactionChanged(payload: ParticipantFactionChangedEvent) {
      if (payload.encounterId !== encounterId) return;
      withSeqCheck(payload.seq, () => {
        patch((prev) => ({
          ...prev,
          seq: payload.seq,
          participants: prev.participants.map((p) =>
            p.participantId === payload.participantId ? { ...p, faction: payload.faction } : p,
          ),
        }));
      });
    }

    function onParticipantAcChanged(payload: ParticipantAcChangedEvent) {
      if (payload.encounterId !== encounterId) return;
      withSeqCheck(payload.seq, () => {
        patch((prev) => ({
          ...prev,
          seq: payload.seq,
          participants: prev.participants.map((p) =>
            p.participantId === payload.participantId ? { ...p, armorClass: payload.armorClass } : p,
          ),
        }));
      });
    }

    socket.on('connect', joinAndSync);
    socket.on('FULL_STATE_SYNC', setFullState);
    socket.on('COMBAT_STARTED', onCombatStarted);
    socket.on('COMBAT_ENDED', onCombatEnded);
    socket.on('INITIATIVE_ROLLED', onInitiativeRolled);
    socket.on('TURN_ADVANCED', onTurnAdvanced);
    socket.on('PARTICIPANT_JOINED', onParticipantJoined);
    socket.on('PARTICIPANT_LEFT', onParticipantLeft);
    socket.on('HP_CHANGED', onHpChanged);
    socket.on('EFFECT_APPLIED', onEffectApplied);
    socket.on('EFFECT_EXPIRED', onEffectExpired);
    socket.on('MAP_UPDATED', onMapUpdated);
    socket.on('TOKEN_MOVED', onTokenMoved);
    socket.on('PARTICIPANT_AC_CHANGED', onParticipantAcChanged);
    socket.on('PARTICIPANT_FACTION_CHANGED', onParticipantFactionChanged);
    socket.on('ACTION_ECONOMY_CHANGED', onActionEconomyChanged);

    joinAndSync();

    return () => {
      socket.off('connect', joinAndSync);
      socket.off('FULL_STATE_SYNC', setFullState);
      socket.off('COMBAT_STARTED', onCombatStarted);
      socket.off('COMBAT_ENDED', onCombatEnded);
      socket.off('INITIATIVE_ROLLED', onInitiativeRolled);
      socket.off('TURN_ADVANCED', onTurnAdvanced);
      socket.off('PARTICIPANT_JOINED', onParticipantJoined);
      socket.off('PARTICIPANT_LEFT', onParticipantLeft);
      socket.off('HP_CHANGED', onHpChanged);
      socket.off('EFFECT_APPLIED', onEffectApplied);
      socket.off('EFFECT_EXPIRED', onEffectExpired);
      socket.off('MAP_UPDATED', onMapUpdated);
      socket.off('TOKEN_MOVED', onTokenMoved);
      socket.off('PARTICIPANT_AC_CHANGED', onParticipantAcChanged);
      socket.off('PARTICIPANT_FACTION_CHANGED', onParticipantFactionChanged);
      socket.off('ACTION_ECONOMY_CHANGED', onActionEconomyChanged);
    };
  }, [encounterId, connected, socket, queryClient]);

  return query.data;
}

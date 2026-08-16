// Phase 4 "DM approval before a player-submitted action resolves" — shared
// query + mutations for the pending-request queue. DM sees every request in
// the encounter; a player sees only their own (server-enforced, see
// services/pendingActions.ts's listPendingActions) — this hook is used by
// both BattleModeDmPanel.tsx (review queue, approve/reject) and the
// player-facing components (AttackRoller/CastPanel/ShoveGrappleControls,
// which just need to know their own submission's current status).
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useSocket } from '../lib/SocketContext';
import type { PendingActionCreatedEvent, PendingActionResolvedEvent } from '../lib/socketTypes';
import type { PendingActionRequest } from '../lib/types';

export function pendingActionsQueryKey(encounterId: string) {
  return ['pendingActions', encounterId] as const;
}

export function usePendingActions(encounterId: string) {
  const queryClient = useQueryClient();
  const { socket } = useSocket();

  const query = useQuery({
    queryKey: pendingActionsQueryKey(encounterId),
    queryFn: () => api.get<{ requests: PendingActionRequest[] }>(`/encounters/${encounterId}/pending-actions`),
  });

  // Bare invalidation on either event — same "refetch the already
  // role-filtered GET" contract as CHARACTERS_UPDATED/BESTIARY_UPDATED,
  // rather than trying to patch a single row into the cached list (the
  // approve/reject response already lands via the mutation's own onSuccess
  // for the actor who triggered it; this covers every OTHER connected
  // socket that needs to find out).
  useEffect(() => {
    function onChanged(payload: PendingActionCreatedEvent | PendingActionResolvedEvent) {
      if (payload.encounterId !== encounterId) return;
      void queryClient.invalidateQueries({ queryKey: pendingActionsQueryKey(encounterId) });
    }
    socket.on('PENDING_ACTION_CREATED', onChanged);
    socket.on('PENDING_ACTION_RESOLVED', onChanged);
    return () => {
      socket.off('PENDING_ACTION_CREATED', onChanged);
      socket.off('PENDING_ACTION_RESOLVED', onChanged);
    };
  }, [socket, encounterId, queryClient]);

  const approveMutation = useMutation({
    mutationFn: (requestId: string) => api.post<{ request: PendingActionRequest }>(`/encounters/${encounterId}/pending-actions/${requestId}/approve`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pendingActionsQueryKey(encounterId) });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (requestId: string) => api.post<{ request: PendingActionRequest }>(`/encounters/${encounterId}/pending-actions/${requestId}/reject`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pendingActionsQueryKey(encounterId) });
    },
  });

  return { query, approveMutation, rejectMutation };
}

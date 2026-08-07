import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { ResourcePool } from '../lib/types';
import type { ResourcePoolChangedEvent } from '../lib/socketTypes';
import { useSocket } from '../lib/SocketContext';

export function resourcesQueryKey(characterId: string) {
  return ['character', characterId, 'resources'] as const;
}

export function useCharacterResources(characterId: string) {
  const queryClient = useQueryClient();
  const { socket } = useSocket();

  // Iteration 3 minor sweep — spend/recover used to broadcast nothing at
  // all, so a same-player-two-tabs (or delegated-controller + owner) view
  // of this character's resource pools went stale until an unrelated event
  // forced a refetch. Same patch-the-cache shape as this file's own
  // spend/recover mutations below, just triggered by the socket event
  // instead of this tab's own request.
  useEffect(() => {
    function onResourcePoolChanged(payload: ResourcePoolChangedEvent) {
      if (payload.characterId !== characterId) return;
      queryClient.setQueryData<{ resources: ResourcePool[] }>(resourcesQueryKey(characterId), (prev) =>
        prev ? { resources: prev.resources.map((r) => (r.resource_key === payload.resource.resource_key ? payload.resource : r)) } : prev,
      );
    }
    socket.on('RESOURCE_POOL_CHANGED', onResourcePoolChanged);
    return () => {
      socket.off('RESOURCE_POOL_CHANGED', onResourcePoolChanged);
    };
  }, [socket, characterId, queryClient]);

  return useQuery({
    queryKey: resourcesQueryKey(characterId),
    queryFn: () => api.get<{ resources: ResourcePool[] }>(`/characters/${characterId}/resources`),
  });
}

// Shared spend/recover mutations for ANY character_resource_pools row —
// reused by both SpellcastingPanel (spell_slot_N / warlock_pact_slot_N rows,
// PLAN.md's "never sum/merge these two trackers" requirement lives entirely
// in how the caller GROUPS resource_key prefixes, not in this mutation
// layer) and ResourcePoolPanel (every other resource_key), rather than
// duplicating the same spend/recover-then-patch-the-cache logic twice.
export function useResourcePoolMutations(characterId: string) {
  const queryClient = useQueryClient();

  function patchPool(resource: ResourcePool) {
    queryClient.setQueryData<{ resources: ResourcePool[] }>(resourcesQueryKey(characterId), (prev) =>
      prev ? { resources: prev.resources.map((r) => (r.resource_key === resource.resource_key ? resource : r)) } : prev,
    );
  }

  const spend = useMutation({
    mutationFn: ({ resourceKey, amount = 1 }: { resourceKey: string; amount?: number }) =>
      api.post<{ resource: ResourcePool }>(`/characters/${characterId}/resources/${resourceKey}/spend`, { amount }),
    onSuccess: (data) => patchPool(data.resource),
  });

  const recover = useMutation({
    mutationFn: ({ resourceKey, amount = 1 }: { resourceKey: string; amount?: number }) =>
      api.post<{ resource: ResourcePool }>(`/characters/${characterId}/resources/${resourceKey}/recover`, { amount }),
    onSuccess: (data) => patchPool(data.resource),
  });

  return { spend, recover };
}

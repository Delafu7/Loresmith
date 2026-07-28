import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { ResourcePool } from '../lib/types';

export function resourcesQueryKey(characterId: string) {
  return ['character', characterId, 'resources'] as const;
}

export function useCharacterResources(characterId: string) {
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

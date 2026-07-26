// Reveal engine data hook (PLAN.md §11.7). GET/PATCH .../reveals are
// DM-only server-side, so this hook is only ever meant to be mounted from a
// DM-role view — same "server-authorized, not client-gated" discipline as
// everything else DM-only in this app; a player-role fetch would just 403.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface RevealFieldState {
  fieldKey: string;
  revealed: boolean;
  playerOverride: string | null;
}

export type RevealEntityType = 'character' | 'monster_instance';

function revealsPath(entityType: RevealEntityType, entityId: number): string {
  return entityType === 'character' ? `/characters/${entityId}/reveals` : `/monster-instances/${entityId}/reveals`;
}

function revealsQueryKey(entityType: RevealEntityType, entityId: number | undefined) {
  return ['reveals', entityType, entityId] as const;
}

export function useReveals(entityType: RevealEntityType, entityId: number | undefined, enabled = true) {
  const queryClient = useQueryClient();
  const queryKey = revealsQueryKey(entityType, entityId);

  const query = useQuery({
    queryKey,
    queryFn: () => api.get<{ fields: RevealFieldState[] }>(revealsPath(entityType, entityId!)),
    enabled: enabled && entityId != null,
  });

  const mutation = useMutation({
    mutationFn: (fields: Array<{ fieldKey: string; revealed: boolean; playerOverride?: string | null }>) =>
      api.patch<{ fields: RevealFieldState[] }>(revealsPath(entityType, entityId!), { fields }),
    // Optimistic: flip the toggle in the cache immediately (this is meant
    // to feel instant — PLAN.md §2.1's "under 200ms" — REVEAL_CHANGED will
    // confirm it over the socket for any other DM tab watching the same
    // entity, and a failed mutation just gets overwritten by the next
    // successful GET/refetch rather than manually rolled back).
    onMutate: async (fields) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<{ fields: RevealFieldState[] }>(queryKey);
      queryClient.setQueryData<{ fields: RevealFieldState[] }>(queryKey, (prev) => {
        const byKey = new Map((prev?.fields ?? []).map((f) => [f.fieldKey, f]));
        for (const f of fields) {
          byKey.set(f.fieldKey, { fieldKey: f.fieldKey, revealed: f.revealed, playerOverride: f.playerOverride ?? null });
        }
        return { fields: [...byKey.values()] };
      });
      return { previous };
    },
    onError: (_err, _fields, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
    },
  });

  function fieldState(fieldKey: string): RevealFieldState | undefined {
    return query.data?.fields.find((f) => f.fieldKey === fieldKey);
  }

  return {
    fields: query.data?.fields ?? [],
    fieldState,
    isLoading: query.isLoading,
    error: query.error,
    setRevealed: (fieldKey: string, revealed: boolean, playerOverride?: string | null) =>
      mutation.mutateAsync([{ fieldKey, revealed, playerOverride: playerOverride ?? null }]),
    isSaving: mutation.isPending,
  };
}

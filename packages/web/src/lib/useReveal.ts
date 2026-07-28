// Weakness-reveal data hook. GET/PATCH /monster-instances/:id/reveals are
// DM-only server-side, so this hook is only ever meant to be mounted from a
// DM-role view — same "server-authorized, not client-gated" discipline as
// everything else DM-only in this app; a player-role fetch would just 403.
// Narrowed to monster instances only — the character half of this engine
// was removed along with the rest of hide/reveal.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export interface RevealFieldState {
  fieldKey: string;
  revealed: boolean;
  playerOverride: string | null;
}

function revealsPath(monsterInstanceId: string): string {
  return `/monster-instances/${monsterInstanceId}/reveals`;
}

function revealsQueryKey(monsterInstanceId: string | undefined) {
  return ['reveals', 'monster_instance', monsterInstanceId] as const;
}

export function useReveals(monsterInstanceId: string | undefined, enabled = true) {
  const queryClient = useQueryClient();
  const queryKey = revealsQueryKey(monsterInstanceId);

  const query = useQuery({
    queryKey,
    queryFn: () => api.get<{ fields: RevealFieldState[] }>(revealsPath(monsterInstanceId!)),
    enabled: enabled && monsterInstanceId != null,
  });

  const mutation = useMutation({
    mutationFn: (fields: Array<{ fieldKey: string; revealed: boolean; playerOverride?: string | null }>) =>
      api.patch<{ fields: RevealFieldState[] }>(revealsPath(monsterInstanceId!), { fields }),
    // Optimistic: flip the toggle in the cache immediately — meant to feel
    // instant; REVEAL_CHANGED will confirm it over the socket for any other
    // DM tab watching the same instance, and a failed mutation just gets
    // overwritten by the next successful GET/refetch rather than manually
    // rolled back.
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

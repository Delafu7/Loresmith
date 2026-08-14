// Shared query/mutation logic for the generic homebrew catalog editor,
// extracted so the same code drives both the campaign-scoped editor
// (CatalogEditorPage.tsx, unchanged behavior) and the personal-compendium
// editor (compendium/CompendiumEditorPage.tsx). The two scopes differ only
// in which write endpoint they hit and how the browse list is filtered —
// GET /catalog/{segment} already unions in campaign homebrew and/or the
// caller's own compendium rows server-side (services/catalog.ts), so the
// read side barely branches at all.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import type { CatalogEntityConfig } from './catalogEntities';

export type CatalogCrudScope =
  | { kind: 'campaign'; campaignId: string; edition: string }
  | { kind: 'user' };

export type CatalogRow = Record<string, unknown> & {
  id: string;
  name: string;
  is_homebrew: boolean;
  owning_campaign_id: string | null;
  owning_user_id: string | null;
  created_at: string;
  updated_at: string;
};

function writeBasePath(scope: CatalogCrudScope, segment: string): string {
  return scope.kind === 'campaign' ? `/campaigns/${scope.campaignId}/catalog/${segment}` : `/compendium/${segment}`;
}

export function useCatalogEntityCrud(scope: CatalogCrudScope, config: CatalogEntityConfig) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey =
    scope.kind === 'campaign'
      ? ['catalog', config.segment, 'campaign', scope.campaignId]
      : ['catalog', config.segment, 'compendium'];

  const listQuery = useQuery({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams();
      if (scope.kind === 'campaign') {
        params.set('campaignId', scope.campaignId);
        if (config.hasEdition) params.set('edition', scope.edition);
      }
      const qs = params.toString();
      return api.get<Record<string, CatalogRow[]>>(`/catalog/${config.segment}${qs ? `?${qs}` : ''}`);
    },
  });
  const entries = listQuery.data?.[config.listResponseKey] ?? [];

  function invalidate() {
    return queryClient.invalidateQueries({ queryKey });
  }

  const basePath = writeBasePath(scope, config.segment);

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post<{ entry: CatalogRow }>(basePath, payload),
    onSuccess: () => invalidate(),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      api.patch<{ entry: CatalogRow }>(`${basePath}/${id}`, payload),
    onSuccess: () => invalidate(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete<void>(`${basePath}/${id}`),
    onSuccess: () => invalidate(),
  });

  const duplicateMutation = useMutation({
    mutationFn: (id: string) => api.post<{ entry: CatalogRow }>(`${basePath}/${id}/duplicate`, {}),
    onSuccess: () => invalidate(),
  });

  // Promote (campaign -> caller's compendium) is only meaningful from the
  // campaign-scoped editor; assign (compendium -> a campaign) only from the
  // compendium editor — each hits the OTHER scope's write surface, so
  // neither reuses basePath above.
  const promoteMutation = useMutation({
    mutationFn: (id: string) => {
      if (scope.kind !== 'campaign') throw new Error('promote is only available from a campaign');
      return api.post<{ entry: CatalogRow }>(`/campaigns/${scope.campaignId}/catalog/${config.segment}/${id}/promote-to-library`, {});
    },
    onSuccess: () => invalidate(),
  });

  const assignMutation = useMutation({
    mutationFn: ({ id, campaignId }: { id: string; campaignId: string }) =>
      api.post<{ entry: CatalogRow }>(`/compendium/${config.segment}/${id}/assign-to-campaign`, { campaignId }),
    onSuccess: () => invalidate(),
  });

  function ownsEntry(entry: CatalogRow): boolean {
    if (!entry.is_homebrew) return false;
    if (scope.kind === 'campaign') return entry.owning_campaign_id === scope.campaignId;
    return entry.owning_user_id !== null && entry.owning_user_id === user?.id;
  }

  return {
    listQuery,
    entries,
    createMutation,
    updateMutation,
    deleteMutation,
    duplicateMutation,
    promoteMutation,
    assignMutation,
    ownsEntry,
    invalidate,
  };
}

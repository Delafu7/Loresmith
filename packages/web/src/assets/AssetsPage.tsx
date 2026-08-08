import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { CampaignAsset, CampaignMember } from '../lib/types';
import { useAuth } from '../auth/AuthContext';
import { useCampaignShell } from '../campaigns/CampaignShell';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { Input } from '../components/ui/Field';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { formatTimestamp } from '../lib/dates';
import { useLocale } from '../i18n/LocaleContext';

export function AssetsPage() {
  const { t } = useLocale();
  const { campaignId, role } = useCampaignShell();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const assetsQuery = useQuery({
    queryKey: ['assets', campaignId],
    queryFn: () => api.get<{ assets: CampaignAsset[] }>(`/campaigns/${campaignId}/assets`),
  });

  // Everyone (not just the DM) can see who uploaded what here, unlike
  // CharactersListPage's DM-only membersQuery — this page itself isn't
  // DM-gated (players manage their own uploads), so the uploader lookup
  // shouldn't be either.
  const membersQuery = useQuery({
    queryKey: ['campaignMembers', campaignId],
    queryFn: () => api.get<{ members: CampaignMember[] }>(`/campaigns/${campaignId}/members`),
  });

  const renameMutation = useMutation({
    mutationFn: ({ assetId, title }: { assetId: string; title: string }) =>
      api.patch<{ asset: CampaignAsset }>(`/assets/${assetId}`, { title }),
    onSuccess: () => {
      setRenamingId(null);
      void queryClient.invalidateQueries({ queryKey: ['assets', campaignId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (assetId: string) => api.delete(`/assets/${assetId}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['assets', campaignId] }),
  });

  const visibilityMutation = useMutation({
    mutationFn: ({ assetId, visibleToPlayers }: { assetId: string; visibleToPlayers: boolean }) =>
      api.patch<{ asset: CampaignAsset }>(`/assets/${assetId}/visibility`, { visibleToPlayers }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['assets', campaignId] }),
  });

  function startRename(asset: CampaignAsset) {
    setRenamingId(asset.id);
    setRenameValue(asset.title ?? '');
  }

  function handleRenameSubmit(e: FormEvent, assetId: string) {
    e.preventDefault();
    if (!renameValue.trim()) return;
    renameMutation.mutate({ assetId, title: renameValue.trim() });
  }

  function uploaderName(userId: string): string {
    if (userId === user?.id) return t('assets.you');
    return membersQuery.data?.members.find((m) => m.user_id === userId)?.display_name ?? t('assets.someone');
  }

  return (
    <div className="px-4 sm:px-6 py-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-lg font-medium">{t('assets.title')}</h2>
      </div>

      {assetsQuery.isLoading && <Loading />}
      {assetsQuery.isError && <ErrorBanner message={errorMessage(assetsQuery.error)} />}
      {assetsQuery.data && assetsQuery.data.assets.length === 0 && (
        <EmptyState message={t('assets.noAssets')} />
      )}

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {assetsQuery.data?.assets.map((asset) => {
          const canModify = role === 'dm' || asset.uploaded_by_user_id === user?.id;
          const isRenaming = renamingId === asset.id;
          const wasRenamed = asset.updated_at !== asset.created_at;

          return (
            <li key={asset.id}>
              <Card>
                <img
                  src={asset.file_url}
                  alt={asset.title ?? t('assets.untitled')}
                  className="h-32 w-full rounded-md border border-stone-800 bg-stone-950 object-cover"
                />

                {isRenaming ? (
                  <form onSubmit={(e) => handleRenameSubmit(e, asset.id)} className="flex flex-col gap-2">
                    <Input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      maxLength={200}
                    />
                    {renameMutation.isError && <ErrorBanner message={errorMessage(renameMutation.error)} />}
                    <div className="flex gap-2">
                      <Button type="submit" variant="primary" size="sm" disabled={renameMutation.isPending}>
                        {renameMutation.isPending ? t('assets.saving') : t('assets.save')}
                      </Button>
                      <Button type="button" variant="secondary" size="sm" onClick={() => setRenamingId(null)}>
                        {t('assets.cancel')}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-medium text-stone-100">{asset.title ?? t('assets.untitled')}</h3>
                    {canModify && (
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {role === 'dm' && (
                          <button
                            type="button"
                            onClick={() =>
                              visibilityMutation.mutate({ assetId: asset.id, visibleToPlayers: !asset.visible_to_players })
                            }
                            disabled={visibilityMutation.isPending}
                            aria-label={asset.visible_to_players ? t('assets.hideFromPlayers') : t('assets.revealToPlayers')}
                            title={asset.visible_to_players ? t('assets.hideFromPlayers') : t('assets.revealToPlayers')}
                            className={`min-h-11 px-1 text-xs disabled:opacity-50 ${
                              asset.visible_to_players ? 'text-stone-400 hover:text-stone-200' : 'text-amber-500 hover:text-amber-400'
                            }`}
                          >
                            {asset.visible_to_players ? '👁' : '🙈'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => startRename(asset)}
                          className="min-h-11 px-1 text-amber-500 hover:text-amber-400 text-xs"
                        >
                          {t('assets.rename')}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm(t('assets.deleteConfirm', { title: asset.title ?? t('assets.thisAsset') }))) {
                              deleteMutation.mutate(asset.id);
                            }
                          }}
                          className="min-h-11 px-1 text-red-400 hover:text-red-300 text-xs"
                        >
                          {t('assets.delete')}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <p className="text-xs text-stone-500">
                  {t('assets.uploadedByLine', { uploader: uploaderName(asset.uploaded_by_user_id), date: formatTimestamp(asset.created_at) })}
                  {wasRenamed && <> · {t('assets.renamed', { date: formatTimestamp(asset.updated_at) })}</>}
                </p>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

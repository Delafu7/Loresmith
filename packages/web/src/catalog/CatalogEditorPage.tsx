import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useCampaignShell } from '../campaigns/CampaignShell';
import { CATALOG_ENTITIES, type CatalogEntityConfig } from './catalogEntities';
import { CatalogEntryForm } from './CatalogEntryForm';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { Select } from '../components/ui/Field';
import { formatTimestamp } from '../lib/dates';
import { useLocale } from '../i18n/LocaleContext';

type CatalogRow = Record<string, unknown> & {
  id: string;
  name: string;
  is_homebrew: boolean;
  owning_campaign_id: string | null;
  created_at: string;
  updated_at: string;
};

// One generic editor for all 11 homebrew-capable catalog entities (see
// catalogEntities.ts for why this isn't 11 bespoke pages). Any campaign
// member can browse; only the DM can create/edit/duplicate/delete, matching
// the server's requireRole('dm') gate on every write route.
export function CatalogEditorPage() {
  const { campaignId, campaign, role } = useCampaignShell();
  const { t } = useLocale();
  const isDm = role === 'dm';
  const queryClient = useQueryClient();
  const [entitySegment, setEntitySegment] = useState(CATALOG_ENTITIES[0]!.segment);
  const config = CATALOG_ENTITIES.find((e) => e.segment === entitySegment)!;
  const [editingEntry, setEditingEntry] = useState<CatalogRow | null | 'new'>(null);

  const listQuery = useQuery({
    queryKey: ['catalog', config.segment, 'campaign', campaignId],
    queryFn: () => {
      const params = new URLSearchParams({ campaignId });
      if (config.hasEdition) params.set('edition', campaign.srd_edition);
      return api.get<Record<string, CatalogRow[]>>(`/catalog/${config.segment}?${params.toString()}`);
    },
  });
  const entries = listQuery.data?.[config.listResponseKey] ?? [];

  function invalidate() {
    return queryClient.invalidateQueries({ queryKey: ['catalog', config.segment, 'campaign', campaignId] });
  }

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.post<{ entry: CatalogRow }>(`/campaigns/${campaignId}/catalog/${config.segment}`, payload),
    onSuccess: async () => {
      await invalidate();
      setEditingEntry(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      api.patch<{ entry: CatalogRow }>(`/campaigns/${campaignId}/catalog/${config.segment}/${id}`, payload),
    onSuccess: async () => {
      await invalidate();
      setEditingEntry(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/campaigns/${campaignId}/catalog/${config.segment}/${id}`),
    onSuccess: () => invalidate(),
  });

  const duplicateMutation = useMutation({
    mutationFn: (id: string) =>
      api.post<{ entry: CatalogRow }>(`/campaigns/${campaignId}/catalog/${config.segment}/${id}/duplicate`, {}),
    onSuccess: async (data) => {
      await invalidate();
      // Land the DM straight into editing their new copy — this is the
      // "fork-on-edit" flow in practice: duplicate official content, then
      // edit your own copy immediately, rather than a silent background copy.
      setEditingEntry(data.entry);
    },
  });

  function ownsEntry(entry: CatalogRow): boolean {
    return entry.is_homebrew && entry.owning_campaign_id === campaignId;
  }

  return (
    <div className="px-4 sm:px-6 py-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-display text-lg font-medium">{t('catalog.list.heading')}</h2>
          <p className="text-sm text-stone-400">
            {t('catalog.list.subtitle', { plural: config.pluralLabel.toLowerCase() })}
          </p>
        </div>
        {isDm && (
          <Button variant="primary" size="sm" onClick={() => setEditingEntry('new')}>
            {t('catalog.list.newEntity', { label: config.label.toLowerCase() })}
          </Button>
        )}
      </div>

      <Select value={entitySegment} onChange={(e) => setEntitySegment(e.target.value)} className="max-w-xs">
        {CATALOG_ENTITIES.map((e) => (
          <option key={e.segment} value={e.segment}>
            {e.pluralLabel}
          </option>
        ))}
      </Select>

      {listQuery.isLoading && <Loading />}
      {listQuery.isError && <ErrorBanner message={errorMessage(listQuery.error)} />}
      {listQuery.data && entries.length === 0 && (
        <EmptyState message={t('catalog.list.noEntries', { plural: config.pluralLabel.toLowerCase() })} />
      )}

      <ul className="space-y-2">
        {entries.map((entry) => (
          <li key={entry.id} className="rounded-md bg-stone-900 shadow-sm px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-stone-100 truncate">{entry.name}</span>
                <Badge variant={entry.is_homebrew ? 'accent' : 'neutral'}>
                  {entry.is_homebrew ? t('catalog.list.homebrewBadge') : t('catalog.list.officialBadge')}
                </Badge>
              </div>
              {/* Only meaningful for homebrew rows — official rows' created_at
                  is just whenever the homebrew-scope migration ran. */}
              {entry.is_homebrew && (
                <p className="text-xs text-stone-500 mt-0.5">
                  {t('catalog.list.createdUpdated', {
                    created: formatTimestamp(entry.created_at),
                    updated: formatTimestamp(entry.updated_at),
                  })}
                </p>
              )}
            </div>
            {isDm && (
              <div className="flex items-center gap-2 flex-shrink-0">
                {ownsEntry(entry) && (
                  <button
                    type="button"
                    onClick={() => setEditingEntry(entry)}
                    className="min-h-11 px-2 text-amber-500 hover:text-amber-400 text-sm"
                  >
                    {t('common.edit')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => duplicateMutation.mutate(entry.id)}
                  disabled={duplicateMutation.isPending}
                  className="min-h-11 px-2 text-stone-300 hover:text-stone-100 text-sm disabled:opacity-50"
                >
                  {t('catalog.list.duplicate')}
                </button>
                {ownsEntry(entry) && (
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(t('catalog.list.confirmDelete', { name: entry.name }))) deleteMutation.mutate(entry.id);
                    }}
                    disabled={deleteMutation.isPending}
                    className="min-h-11 px-2 text-red-400 hover:text-red-300 text-sm disabled:opacity-50"
                  >
                    {t('common.delete')}
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {(deleteMutation.isError || duplicateMutation.isError) && (
        <ErrorBanner message={errorMessage((deleteMutation.error ?? duplicateMutation.error) as unknown)} />
      )}

      <CatalogEntryModal
        campaignId={campaignId}
        edition={campaign.srd_edition}
        config={config}
        editingEntry={editingEntry}
        onClose={() => setEditingEntry(null)}
        onCreate={(payload) => createMutation.mutateAsync(payload)}
        onUpdate={(id, payload) => updateMutation.mutateAsync({ id, payload })}
        submitting={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  );
}

function CatalogEntryModal({
  campaignId,
  edition,
  config,
  editingEntry,
  onClose,
  onCreate,
  onUpdate,
  submitting,
}: {
  campaignId: string;
  edition: string;
  config: CatalogEntityConfig;
  editingEntry: CatalogRow | null | 'new';
  onClose: () => void;
  onCreate: (payload: Record<string, unknown>) => Promise<unknown>;
  onUpdate: (id: string, payload: Record<string, unknown>) => Promise<unknown>;
  submitting: boolean;
}) {
  const { t } = useLocale();
  if (editingEntry === null) return null;
  const entry = editingEntry === 'new' ? null : editingEntry;
  const draftKey = `draft:catalog:${campaignId}:${config.segment}:${entry ? entry.id : 'new'}`;

  return (
    <Modal
      open
      onClose={onClose}
      title={
        entry
          ? t('catalog.list.modalEditTitle', { label: config.label.toLowerCase() })
          : t('catalog.list.modalNewTitle', { label: config.label.toLowerCase() })
      }
      size="lg"
    >
      <CatalogEntryForm
        fields={config.fields}
        entry={entry}
        draftKey={draftKey}
        campaignId={campaignId}
        edition={edition}
        submitting={submitting}
        onCancel={onClose}
        onSubmit={(payload) => (entry ? onUpdate(entry.id, payload) : onCreate(payload))}
      />
    </Modal>
  );
}

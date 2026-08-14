import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Campaign } from '../lib/types';
import { CATALOG_ENTITIES } from '../catalog/catalogEntities';
import { useCatalogEntityCrud, type CatalogRow } from '../catalog/useCatalogEntityCrud';
import { CatalogEntryModal } from '../catalog/CatalogEditorPage';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Select } from '../components/ui/Field';
import { formatTimestamp } from '../lib/dates';
import { useLocale } from '../i18n/LocaleContext';

// The personal, campaign-independent counterpart to catalog/CatalogEditorPage.tsx
// — same generic registry (CATALOG_ENTITIES), same form/list chrome, driven
// by the same useCatalogEntityCrud hook with scope: { kind: 'user' } instead
// of { kind: 'campaign', campaignId }. Every DM can author here regardless
// of which (if any) campaign they're currently viewing; content created here
// shows up automatically in every campaign they run (server-side
// owning_user_id union, services/catalog.ts).
export function CompendiumEditorPage() {
  const { t } = useLocale();
  const [entitySegment, setEntitySegment] = useState(CATALOG_ENTITIES[0]!.segment);
  const config = CATALOG_ENTITIES.find((e) => e.segment === entitySegment)!;
  const [editingEntry, setEditingEntry] = useState<CatalogRow | null | 'new'>(null);
  const [assigningEntryId, setAssigningEntryId] = useState<string | null>(null);

  const scope = { kind: 'user' as const };
  const {
    listQuery,
    entries,
    createMutation,
    updateMutation,
    deleteMutation,
    duplicateMutation,
    assignMutation,
    ownsEntry,
  } = useCatalogEntityCrud(scope, config);

  // Reference-array/reference fields on 'both'-edition entries have no
  // single campaign edition to filter by outside a campaign — 'both' means
  // "no edition filter" (editionFilter in services/catalog.ts), so every
  // edition's reference options show up, same as browsing with no edition
  // query param at all.
  const formEdition = 'both';

  const dmCampaignsQuery = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => api.get<{ campaigns: Campaign[] }>('/campaigns'),
    enabled: assigningEntryId !== null,
  });
  const dmCampaigns = (dmCampaignsQuery.data?.campaigns ?? []).filter((c) => c.my_role === 'dm');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-sm text-stone-400">
            {t('catalog.list.compendiumSubtitle', { plural: config.pluralLabel.toLowerCase() })}
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setEditingEntry('new')}>
          {t('catalog.list.newEntity', { label: config.label.toLowerCase() })}
        </Button>
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
              {entry.is_homebrew && (
                <p className="text-xs text-stone-500 mt-0.5">
                  {t('catalog.list.createdUpdated', {
                    created: formatTimestamp(entry.created_at),
                    updated: formatTimestamp(entry.updated_at),
                  })}
                </p>
              )}
              {assigningEntryId === entry.id && (
                <div className="mt-2 flex items-center gap-2">
                  <Select
                    className="max-w-xs"
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) {
                        assignMutation.mutate({ id: entry.id, campaignId: e.target.value });
                        setAssigningEntryId(null);
                      }
                    }}
                  >
                    <option value="" disabled>
                      {t('catalog.list.selectCampaign')}
                    </option>
                    {dmCampaigns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
            </div>
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
                  onClick={() => setAssigningEntryId(assigningEntryId === entry.id ? null : entry.id)}
                  className="min-h-11 px-2 text-stone-300 hover:text-stone-100 text-sm"
                >
                  {t('catalog.list.assignToCampaign')}
                </button>
              )}
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
          </li>
        ))}
      </ul>

      {(deleteMutation.isError || duplicateMutation.isError || assignMutation.isError) && (
        <ErrorBanner message={errorMessage((deleteMutation.error ?? duplicateMutation.error ?? assignMutation.error) as unknown)} />
      )}

      <CatalogEntryModal
        draftScope="compendium"
        campaignId={undefined}
        edition={formEdition}
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

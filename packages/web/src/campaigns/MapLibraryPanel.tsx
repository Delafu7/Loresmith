// Campaign-scoped map library picker (1784269788666_create-campaign-maps-library.ts)
// — DM-only, collapsed by default (this page is already dense with the
// battle grid + party sidebar). Lets the DM reuse a map across encounters
// or spin up a new one, without touching BattleMap.tsx's existing inline
// "Reconfigure map" settings form (which keeps editing whichever map is
// currently active, unchanged).

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { CampaignMap } from '../lib/types';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { Button } from '../components/ui/Button';
import { useLocale } from '../i18n/LocaleContext';

export function MapLibraryPanel({
  campaignId,
  encounterId,
  activeMapId,
}: {
  campaignId: string;
  encounterId: string;
  activeMapId: string | undefined;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-md bg-stone-950 shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium uppercase tracking-wider text-stone-400 hover:text-stone-200"
      >
        {t('mapSection.library.title')}
        <span>{open ? (t('mapSection.library.hide')) : t('mapSection.library.show')}</span>
      </button>
      {open && <MapLibraryContent campaignId={campaignId} encounterId={encounterId} activeMapId={activeMapId} />}
    </div>
  );
}

function MapLibraryContent({
  campaignId,
  encounterId,
  activeMapId,
}: {
  campaignId: string;
  encounterId: string;
  activeMapId: string | undefined;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');

  const mapsQuery = useQuery({
    queryKey: ['campaignMaps', campaignId],
    queryFn: () => api.get<{ maps: CampaignMap[] }>(`/campaigns/${campaignId}/maps`),
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['campaignMaps', campaignId] });
  }

  const createMutation = useMutation({
    mutationFn: (name: string) => api.post<{ map: CampaignMap }>(`/campaigns/${campaignId}/maps`, { name }),
    onSuccess: () => {
      setNewName('');
      invalidate();
    },
  });

  const activateMutation = useMutation({
    mutationFn: (mapId: string) => api.post(`/encounters/${encounterId}/active-map`, { mapId }),
    // No local cache write — the MAP_UPDATED socket event (which this DM's
    // own action also triggers) patches live.map, same discipline as every
    // other encounter-runner mutation in useEncounterSessionData.ts.
  });

  const deleteMutation = useMutation({
    mutationFn: (mapId: string) => api.delete(`/campaigns/${campaignId}/maps/${mapId}`),
    onSuccess: invalidate,
  });

  const maps = mapsQuery.data?.maps ?? [];

  return (
    <div className="border-t border-stone-800 p-3 space-y-3">
      {mapsQuery.isLoading && <Loading />}
      {mapsQuery.isError && <ErrorBanner message={errorMessage(mapsQuery.error)} />}
      {!mapsQuery.isLoading && maps.length === 0 && <EmptyState message={t('mapSection.library.empty')} />}

      <ul className="space-y-1.5">
        {maps.map((map) => {
          const isActive = map.id === activeMapId;
          return (
            <li
              key={map.id}
              className={`flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-xs ${
                isActive ? 'border-amber-600 bg-amber-950/20' : 'border-stone-800 bg-stone-900'
              }`}
            >
              <span className="truncate text-stone-200">{map.name}</span>
              <div className="flex flex-shrink-0 items-center gap-1.5">
                {isActive ? (
                  <span className="text-amber-500 font-medium">{t('mapSection.library.active')}</span>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={activateMutation.isPending}
                    onClick={() => activateMutation.mutate(map.id)}
                  >
                    {activateMutation.isPending ? t('mapSection.library.activating') : t('mapSection.library.activate')}
                  </Button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(t('mapSection.library.confirmDelete', { name: map.name }))) deleteMutation.mutate(map.id);
                  }}
                  className="text-red-400 hover:text-red-300 px-1"
                  aria-label={`${t('mapSection.library.delete')} ${map.name}`}
                >
                  ✕
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (newName.trim() === '') return;
          createMutation.mutate(newName.trim());
        }}
      >
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={t('mapSection.library.namePlaceholder')}
          maxLength={200}
          className="min-w-0 flex-1 rounded-md bg-stone-800 border border-stone-700 px-2 py-1 text-xs text-stone-100"
        />
        <Button type="submit" size="sm" disabled={createMutation.isPending || newName.trim() === ''}>
          {createMutation.isPending ? t('mapSection.library.creating') : t('mapSection.library.create')}
        </Button>
      </form>
      {createMutation.isError && <ErrorBanner message={errorMessage(createMutation.error)} />}
      {deleteMutation.isError && <ErrorBanner message={errorMessage(deleteMutation.error)} />}
    </div>
  );
}

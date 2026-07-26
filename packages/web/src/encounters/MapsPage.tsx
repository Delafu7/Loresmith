import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Encounter } from '../lib/types';
import { useCampaignShell } from '../campaigns/CampaignShell';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { useEncounterLive } from './useEncounterLive';
import { BattleMap } from './BattleMap';

const STATUS_ORDER: Record<Encounter['status'], number> = { active: 0, paused: 1, preparing: 2, completed: 3 };

export function MapsPage() {
  const { campaignId, role } = useCampaignShell();
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const encountersQuery = useQuery({
    queryKey: ['encounters', campaignId],
    queryFn: () => api.get<{ encounters: Encounter[] }>(`/campaigns/${campaignId}/encounters`),
  });

  const sorted = useMemo(
    () => [...(encountersQuery.data?.encounters ?? [])].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]),
    [encountersQuery.data],
  );

  const selected = sorted.find((e) => e.id === selectedId) ?? null;
  const live = useEncounterLive(selected?.id);

  return (
    <div className="px-4 sm:px-6 py-6 max-w-6xl mx-auto">
      <div className="flex flex-col lg:flex-row gap-6">
        <aside className="lg:w-64 flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Encounters</h2>
          </div>

          {encountersQuery.isLoading && <Loading />}
          {encountersQuery.isError && <ErrorBanner message={errorMessage(encountersQuery.error)} />}
          {sorted.length === 0 && !encountersQuery.isLoading && <EmptyState message="No encounters yet." />}

          <ul className="space-y-1">
            {sorted.map((enc) => (
              <li key={enc.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(enc.id)}
                  className={`w-full text-left rounded-md px-3 py-2 text-sm transition-colors ${
                    enc.id === selectedId ? 'bg-amber-600 text-stone-950 font-medium' : 'bg-stone-900 text-stone-300 hover:bg-stone-800'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{enc.name}</span>
                    <StatusBadge status={enc.status} active={enc.id === selectedId} />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <div className="flex-1 min-w-0">
          {!selected ? (
            <EmptyState message="Select an encounter to view its map." />
          ) : (
            <BattleMap
              encounterId={selected.id}
              campaignId={campaignId}
              map={live?.map ?? null}
              participants={live?.participants ?? []}
              activeParticipantId={live?.activeParticipantId ?? null}
              isDm={role === 'dm'}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status, active }: { status: Encounter['status']; active: boolean }) {
  return (
    <span
      className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded ${
        active ? 'bg-stone-950/30 text-stone-950' : 'bg-stone-800 text-stone-400'
      }`}
    >
      {status}
    </span>
  );
}

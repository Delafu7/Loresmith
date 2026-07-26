// REFACTOR-PLAN.md §1: "opening a map from a campaign redirects to
// /maps/:mapId — the map renders full-screen, not embedded in a small
// panel." This tab is now just a picker; the actual BattleMap render moved
// entirely to FullscreenMapPage (maps/FullscreenMapPage.tsx).

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { Encounter } from '../lib/types';
import { useCampaignShell } from '../campaigns/CampaignShell';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';

const STATUS_ORDER: Record<Encounter['status'], number> = { active: 0, paused: 1, preparing: 2, completed: 3 };

export function MapsPage() {
  const { campaignId } = useCampaignShell();

  const encountersQuery = useQuery({
    queryKey: ['encounters', campaignId],
    queryFn: () => api.get<{ encounters: Encounter[] }>(`/campaigns/${campaignId}/encounters`),
  });

  const sorted = useMemo(
    () => [...(encountersQuery.data?.encounters ?? [])].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]),
    [encountersQuery.data],
  );

  return (
    <div className="px-4 sm:px-6 py-6 max-w-3xl mx-auto">
      <h2 className="text-lg font-semibold mb-3">Maps</h2>

      {encountersQuery.isLoading && <Loading />}
      {encountersQuery.isError && <ErrorBanner message={errorMessage(encountersQuery.error)} />}
      {sorted.length === 0 && !encountersQuery.isLoading && <EmptyState message="No encounters yet." />}

      <ul className="space-y-2">
        {sorted.map((enc) => (
          <li key={enc.id}>
            <Link
              to={`/maps/${enc.id}`}
              className="flex items-center justify-between gap-2 rounded-md border border-stone-800 bg-stone-900 hover:border-amber-700 hover:bg-stone-800/60 transition-colors px-4 py-3"
            >
              <span className="truncate font-medium text-stone-100">{enc.name}</span>
              <StatusBadge status={enc.status} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusBadge({ status }: { status: Encounter['status'] }) {
  return (
    <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-stone-800 text-stone-400 flex-shrink-0">
      {status}
    </span>
  );
}

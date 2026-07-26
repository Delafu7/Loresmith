// Full-screen map view, its own route (REFACTOR-PLAN.md §1: /maps/:mapId —
// "mapId" is the encounter id, since encounter_maps is 1:1 with an
// encounter; there's no separate campaign-level map entity in this schema
// yet, see OPEN_QUESTIONS.md #1). Opening a map from inside a campaign
// (the existing per-campaign Maps tab) redirects here rather than embedding
// the map in a panel.

import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { Loading, ErrorBanner, errorMessage } from '../components/Feedback';
import { useEncounterLive } from '../encounters/useEncounterLive';
import { BattleMap } from '../encounters/BattleMap';

interface FlatEncounter {
  id: number;
  campaign_id: number;
  name: string;
  status: string;
  myRole: 'dm' | 'player';
}

export function FullscreenMapPage() {
  const params = useParams<{ mapId: string }>();
  const encounterId = Number(params.mapId);

  const encounterQuery = useQuery({
    queryKey: ['encounter', 'flat', encounterId],
    queryFn: () => api.get<{ encounter: FlatEncounter }>(`/encounters/${encounterId}`),
    enabled: Number.isInteger(encounterId),
  });

  const live = useEncounterLive(Number.isInteger(encounterId) ? encounterId : undefined);
  const encounter = encounterQuery.data?.encounter;

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100 flex flex-col">
      <header className="border-b border-stone-800 px-4 py-2 flex items-center gap-4 flex-shrink-0">
        {encounter ? (
          <Link
            to={`/campaigns/${encounter.campaign_id}/maps`}
            className="text-xs text-stone-500 hover:text-stone-300"
          >
            ← {encounter.name}
          </Link>
        ) : (
          <Link to="/maps" className="text-xs text-stone-500 hover:text-stone-300">
            ← Maps
          </Link>
        )}
      </header>
      <main className="flex-1 min-h-0 px-4 py-4 overflow-auto">
        {encounterQuery.isLoading && <Loading />}
        {encounterQuery.isError && <ErrorBanner message={errorMessage(encounterQuery.error)} />}
        {encounter && (
          <BattleMap
            encounterId={encounter.id}
            campaignId={encounter.campaign_id}
            map={live?.map ?? null}
            participants={live?.participants ?? []}
            activeParticipantId={live?.activeParticipantId ?? null}
            isDm={encounter.myRole === 'dm'}
          />
        )}
      </main>
    </div>
  );
}

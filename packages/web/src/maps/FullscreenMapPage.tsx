// Full-screen map view, its own route (REFACTOR-PLAN.md §1: /maps/:mapId —
// "mapId" is the encounter id, since encounter_maps is 1:1 with an
// encounter; there's no separate campaign-level map entity in this schema
// yet, see OPEN_QUESTIONS.md #1). Opening a map from inside a campaign
// (the existing per-campaign Maps tab) redirects here rather than embedding
// the map in a panel.

import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import type { Character } from '../lib/types';
import { Loading, ErrorBanner, errorMessage } from '../components/Feedback';
import { useEncounterLive } from '../encounters/useEncounterLive';
import { BattleMap } from '../encounters/BattleMap';
import { isUuid } from '../lib/ids';
import { useLocale } from '../i18n/LocaleContext';

interface FlatEncounter {
  id: string;
  campaign_id: string;
  name: string;
  status: string;
  myRole: 'dm' | 'player';
}

export function FullscreenMapPage() {
  const { t } = useLocale();
  const { user } = useAuth();
  const params = useParams<{ mapId: string }>();
  const encounterId = params.mapId ?? '';

  const encounterQuery = useQuery({
    queryKey: ['encounter', 'flat', encounterId],
    queryFn: () => api.get<{ encounter: FlatEncounter }>(`/encounters/${encounterId}`),
    enabled: isUuid(encounterId),
  });

  const live = useEncounterLive(isUuid(encounterId) ? encounterId : undefined);
  const encounter = encounterQuery.data?.encounter;

  // Not DM-only — a player needs this to know which token on the board is
  // their own (BattleMap's myCharacterIds, same pattern as CombatTracker.tsx).
  const charactersQuery = useQuery({
    queryKey: ['characters', encounter?.campaign_id],
    queryFn: () => api.get<{ characters: Character[] }>(`/campaigns/${encounter!.campaign_id}/characters`),
    enabled: encounter != null,
  });
  const myCharacterIds = new Set(
    charactersQuery.data?.characters.filter((c) => c.owner_user_id === user?.id).map((c) => c.id) ?? [],
  );

  return (
    <div className="h-dvh bg-stone-950 text-stone-100 flex flex-col overflow-hidden">
      <header className="border-b border-stone-800 px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] flex items-center gap-4 flex-shrink-0">
        {encounter ? (
          <Link
            to={`/campaigns/${encounter.campaign_id}/maps`}
            className="text-xs text-stone-500 hover:text-stone-300"
          >
            ← {encounter.name}
          </Link>
        ) : (
          <Link to="/maps" className="text-xs text-stone-500 hover:text-stone-300">
            {t('maps.backToMaps')}
          </Link>
        )}
      </header>
      {/* Full-bleed on mobile — the map owns the viewport (Phase 3: "on
          narrow screens the map goes full-bleed and owns the viewport").
          No horizontal padding below sm: so the board runs edge to edge;
          BattleMap's own internal scroll container handles the board's
          scroll/pinch-zoom, this just stops double-scrollbars. */}
      <main className="flex-1 min-h-0 px-0 py-2 sm:px-4 sm:py-4 overflow-y-auto pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {encounterQuery.isLoading && <Loading />}
        {encounterQuery.isError && <ErrorBanner message={errorMessage(encounterQuery.error)} />}
        {encounter && (
          <BattleMap
            encounterId={encounter.id}
            campaignId={encounter.campaign_id}
            map={live?.map ?? null}
            participants={live?.participants ?? []}
            activeParticipantId={live?.activeParticipantId ?? null}
            encounter={live?.encounter ?? { mode: 'exploration', status: 'preparing', currentTurnIndex: 0 }}
            isDm={encounter.myRole === 'dm'}
            myCharacterIds={myCharacterIds}
          />
        )}
      </main>
    </div>
  );
}

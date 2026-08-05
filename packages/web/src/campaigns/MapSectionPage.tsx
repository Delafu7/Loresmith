// Dedicated Map section (design/map.html) — the DM's normal, always-
// reachable place to position tokens and see every participant's stats,
// separate from both the reduced Session/prep page (no map anymore, see
// SessionScreen.tsx's showMap prop) and the fullscreen live-combat takeover
// (LiveMapPage.tsx, unchanged — this section works ALONGSIDE it, not instead
// of it: once the DM starts combat, useLiveMapAutoOpen still pushes everyone
// into fullscreen exactly as before). Shows whichever encounter is currently
// the campaign's focus — same pick CampaignDashboardPage's "next session"
// card uses — with no picker, per the approved scope for this feature.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Encounter } from '../lib/types';
import { useCampaignShell } from './CampaignShell';
import { useEncounterSessionData } from '../encounters/useEncounterSessionData';
import { BattleMap } from '../encounters/BattleMap';
import { MapLibraryPanel } from './MapLibraryPanel';
import { PartyStatsSidebar } from '../encounters/PartyStatsSidebar';
import { SessionOverlayPanel } from '../encounters/SessionOverlayPanel';
import { ParticipantSheetPanel } from '../encounters/ParticipantSheetPanel';
import { Loading, ErrorBanner, EmptyState, errorMessage } from '../components/Feedback';
import { ButtonLink } from '../components/ui/Button';
import { useLocale } from '../i18n/LocaleContext';

const STATUS_PRIORITY: Record<Encounter['status'], number> = { active: 0, paused: 1, preparing: 2, completed: 3 };

// Status wins first (an active/paused encounter is definitionally "the one
// happening now"), but within the same status a non-empty encounter beats
// an empty one — this campaign's own test data caught the bug this guards
// against: an old empty "preparing" encounter sorted ahead of the one that
// actually had tokens placed on it, just for being created first, leaving
// the Map section pointed at nothing. Recency is the last tie-break.
function pickFocusEncounter(encounters: Encounter[]): Encounter | undefined {
  return [...encounters]
    .filter((e) => e.status !== 'completed')
    .sort((a, b) => {
      const statusDiff = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
      if (statusDiff !== 0) return statusDiff;
      const hasParticipantsDiff = Number((b.participant_count ?? 0) > 0) - Number((a.participant_count ?? 0) > 0);
      if (hasParticipantsDiff !== 0) return hasParticipantsDiff;
      return b.created_at.localeCompare(a.created_at);
    })[0];
}

export function MapSectionPage() {
  const { campaignId } = useCampaignShell();
  const { t } = useLocale();

  const encountersQuery = useQuery({
    queryKey: ['encounters', campaignId],
    queryFn: () => api.get<{ encounters: Encounter[] }>(`/campaigns/${campaignId}/encounters`),
  });

  if (encountersQuery.isLoading) return <Loading />;
  if (encountersQuery.isError) return <ErrorBanner message={errorMessage(encountersQuery.error)} />;

  const focusEncounter = pickFocusEncounter(encountersQuery.data?.encounters ?? []);
  if (!focusEncounter) {
    return (
      <div className="p-4">
        <EmptyState message={t('mapSection.noEncounter')} />
        <div className="mt-3">
          <ButtonLink to={`/campaigns/${campaignId}/session`} variant="ghost" size="sm">
            {t('mapSection.goToSessionLink')}
          </ButtonLink>
        </div>
      </div>
    );
  }

  return <MapSectionForEncounter encounter={focusEncounter} />;
}

function MapSectionForEncounter({ encounter }: { encounter: Encounter }) {
  const { campaignId, isDm, live, myCharacterIds, characters, monsterInstances, monsters, removeEffectMutation } = useMapSectionData(encounter);
  const { t } = useLocale();
  const [selectedParticipantId, setSelectedParticipantId] = useState<string | null>(null);

  if (!live) {
    return <p className="p-4 text-sm text-stone-500 italic">{isDm ? t('encounters.tracker.connectingLive') : t('encounters.tracker.noCharacterYet')}</p>;
  }

  const selectedParticipant = selectedParticipantId
    ? (live.participants.find((p) => p.participantId === selectedParticipantId) ?? null)
    : null;

  return (
    <div className="grid h-[calc(100dvh-9rem)] grid-cols-1 gap-2 p-2 md:grid-cols-[1fr_280px]">
      <div className="min-h-0">
        <BattleMap
          encounterId={encounter.id}
          campaignId={campaignId}
          map={live.map}
          participants={live.participants}
          activeParticipantId={live.activeParticipantId}
          encounter={live.encounter}
          isDm={isDm}
          myCharacterIds={myCharacterIds}
          onOpenSheet={setSelectedParticipantId}
        />
      </div>
      <div className="min-h-0 flex flex-col gap-2 overflow-y-auto">
        {isDm && <MapLibraryPanel campaignId={campaignId} encounterId={encounter.id} activeMapId={live.map?.id} />}
        <div className="min-h-0 flex-1 rounded-md bg-stone-950 shadow-sm">
          <PartyStatsSidebar
            participants={live.participants}
            activeParticipantId={live.activeParticipantId}
            onSelect={setSelectedParticipantId}
          />
        </div>
      </div>
      <SessionOverlayPanel open={selectedParticipant != null} onClose={() => setSelectedParticipantId(null)} title={selectedParticipant?.name ?? ''}>
        {selectedParticipant && (
          <ParticipantSheetPanel
            participant={selectedParticipant}
            isDm={isDm}
            encounterId={encounter.id}
            characters={characters}
            monsterInstances={monsterInstances}
            monsters={monsters}
            allParticipants={live.participants}
            myCharacterIds={myCharacterIds}
            activeParticipantId={live.activeParticipantId}
            onClose={() => setSelectedParticipantId(null)}
            onRemoveEffect={isDm ? (effectId) => removeEffectMutation.mutate(effectId) : undefined}
          />
        )}
      </SessionOverlayPanel>
    </div>
  );
}

// Thin wrapper around useEncounterSessionData — this page only needs a
// handful of its ~20 return fields (no prep/combat-control mutations, this
// isn't the prep or fullscreen-combat surface), pulled out so the calling
// component above doesn't carry unused destructured names.
function useMapSectionData(encounter: Encounter) {
  const data = useEncounterSessionData(encounter);
  return {
    campaignId: data.campaignId,
    isDm: data.isDm,
    live: data.live,
    myCharacterIds: data.myCharacterIds,
    characters: data.charactersQuery.data?.characters,
    monsterInstances: data.monsterInstancesQuery.data?.monsterInstances,
    monsters: data.bestiaryQuery.data?.monsters,
    removeEffectMutation: data.removeEffectMutation,
  };
}

// Map-first encounter system: the fullscreen viewport takeover. Registered
// in App.tsx OUTSIDE AppLayout (same "skip the persistent header" pattern
// StyleguidePage already uses) so this renders with zero header/breadcrumb
// chrome — a real route (not a portal-over-everything), which is what gets
// reload-survival and back-button semantics for free. Provides its own
// CampaignShellContext (exported from CampaignShell.tsx for exactly this)
// since this tree lives outside <CampaignShell>, then reuses
// useEncounterSessionData/SessionScreen completely unchanged — this is the
// same map+overlay stack the embedded /session route renders, just full-bleed
// with a minimal top strip instead of the app header.
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Campaign, CampaignRole, Encounter, EncounterWithParticipants } from '../lib/types';
import { RequireAuth } from '../auth/RequireAuth';
import { useAuth } from '../auth/AuthContext';
import { CampaignShellContext } from '../campaigns/CampaignShell';
import { useJoinCampaign } from '../lib/useJoinCampaign';
import { isUuid } from '../lib/ids';
import { Loading, ErrorBanner, errorMessage } from '../components/Feedback';
import { useLocale } from '../i18n/LocaleContext';
import { useEncounterSessionData } from './useEncounterSessionData';
import { SessionScreen } from './SessionScreen';
import { setEncounterMinimized } from '../lib/liveMapState';

export function LiveMapPage() {
  return (
    <RequireAuth>
      <LiveMapPageInner />
    </RequireAuth>
  );
}

function LiveMapPageInner() {
  const params = useParams<{ campaignId: string; encounterId: string }>();
  const campaignId = params.campaignId ?? '';
  const encounterId = params.encounterId ?? '';
  const navigate = useNavigate();
  const { t } = useLocale();
  const { roleForCampaign } = useAuth();

  useJoinCampaign(campaignId);

  const campaignQuery = useQuery({
    queryKey: ['campaign', campaignId],
    queryFn: () => api.get<{ campaign: Campaign; myRole: CampaignRole }>(`/campaigns/${campaignId}`),
    enabled: isUuid(campaignId),
  });

  // Deliberately a DIFFERENT query key from useEncounterSessionData's own
  // ['encounterDetail', id] (which fetches the nested /campaigns/:id/
  // encounters/:id shape) — this is only used here to bootstrap `encounter`
  // for the very first render before useEncounterSessionData mounts (this
  // page lives outside CampaignShell, so it has no campaignId-scoped context
  // to reuse that hook's own fetch yet). Sharing a key with a different
  // response shape would let TanStack Query serve one query's cached data to
  // the other's reader, since a query's cache entry doesn't track "which
  // queryFn populated it" — whichever observer's fetch lands last wins for
  // BOTH, silently producing the wrong shape for one of them (e.g. reading
  // `.encounter.status` on a payload that has no `.encounter` wrapper).
  //
  // GET /encounters/:id (encountersRouter, routes/encounters.ts) responds
  // `res.json({ encounter })` — always wrapped, even though the underlying
  // service (getEncounterFlat) returns an already-flat object — so the
  // response body here is `{ encounter: {...} }`, not the flat shape
  // directly. Reading `.encounter` below is required, not optional; omitting
  // it left `encounter.id` as `undefined`, which cascaded into
  // useEncounterSessionData requesting `/campaigns/:id/encounters/undefined`
  // (a 500) and the map never leaving "Connecting to live combat state…" —
  // confirmed live via the browser network tab, not guessed.
  const encounterQuery = useQuery({
    queryKey: ['encounterFlat', encounterId],
    queryFn: () => api.get<{ encounter: EncounterWithParticipants & { myRole: CampaignRole } }>(`/encounters/${encounterId}`),
    enabled: isUuid(encounterId),
  });

  // Switch directly to a different encounter's live map without leaving
  // fullscreen — same list EncountersPage already fetches (DM sees every
  // non-preparing-or-not status too; a player only ever sees what
  // listEncounters already allows them to). Switching just navigates; the
  // target encounter's own useEncounterSessionData/useEncounterLive mount
  // fresh once this component remounts for the new :encounterId param.
  const encountersListQuery = useQuery({
    queryKey: ['encounters', campaignId],
    queryFn: () => api.get<{ encounters: Encounter[] }>(`/campaigns/${campaignId}/encounters`),
    enabled: isUuid(campaignId),
  });

  function minimize() {
    setEncounterMinimized(encounterId, true);
    navigate(`/campaigns/${campaignId}/session`);
  }

  function switchTo(targetEncounterId: string) {
    if (!targetEncounterId || targetEncounterId === encounterId) return;
    setEncounterMinimized(encounterId, false);
    navigate(`/campaigns/${campaignId}/live/${targetEncounterId}`);
  }

  if (campaignQuery.isLoading || encounterQuery.isLoading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-stone-950">
        <Loading label={t('common.loading')} />
      </div>
    );
  }
  if (campaignQuery.isError) {
    return (
      <div className="p-6 bg-stone-950 min-h-dvh">
        <ErrorBanner message={errorMessage(campaignQuery.error)} />
      </div>
    );
  }
  if (encounterQuery.isError) {
    return (
      <div className="p-6 bg-stone-950 min-h-dvh">
        <ErrorBanner message={errorMessage(encounterQuery.error)} />
      </div>
    );
  }
  if (!campaignQuery.data || !encounterQuery.data) return null;

  const role = roleForCampaign(campaignId) ?? campaignQuery.data.myRole;
  const encounter: Encounter = encounterQuery.data.encounter;

  return (
    <CampaignShellContext.Provider value={{ campaignId, campaign: campaignQuery.data.campaign, role }}>
      <div className="flex h-dvh flex-col bg-stone-950 text-stone-100 overflow-hidden">
        <div className="flex flex-shrink-0 items-center justify-between gap-2 px-2 py-1 pt-[max(0.25rem,env(safe-area-inset-top))]">
          <span className="truncate text-xs text-stone-500">{campaignQuery.data.campaign.name}</span>
          <div className="flex flex-shrink-0 items-center gap-1.5">
            {(encountersListQuery.data?.encounters.length ?? 0) > 1 && (
              <select
                value={encounterId}
                onChange={(e) => switchTo(e.target.value)}
                aria-label={t('encounters.live.switchSession')}
                className="min-h-9 max-w-[40vw] rounded-md bg-stone-900 shadow-sm px-2 text-xs text-stone-300"
              >
                {encountersListQuery.data?.encounters.map((enc) => (
                  <option key={enc.id} value={enc.id}>
                    {enc.name}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={minimize}
              title={t('encounters.live.minimize')}
              className="flex-shrink-0 min-h-9 rounded-md bg-stone-900 shadow-sm px-2.5 text-xs text-stone-400 hover:bg-stone-800 hover:text-stone-200"
            >
              {t('encounters.live.minimize')}
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 px-1 pb-1">
          <LiveMapSession encounter={encounter} />
        </div>
      </div>
    </CampaignShellContext.Provider>
  );
}

function LiveMapSession({ encounter }: { encounter: Encounter }) {
  const { t } = useLocale();
  const {
    campaignId,
    isDm,
    live,
    expandedParticipantId,
    setExpandedParticipantId,
    showDiceRoller,
    setShowDiceRoller,
    charactersQuery,
    monsterInstancesQuery,
    bestiaryQuery,
    myCharacterIds,
    availableCharacters,
    availableMonsterInstances,
    startMutation,
    endMutation,
    startCombatMutation,
    endCombatMutation,
    dispositionMutation,
    forceFullscreenMutation,
    rollInitiativeMutation,
    advanceTurnMutation,
    removeParticipantMutation,
    visibilityMutation,
    addParticipantMutation,
    hpMutation,
    applyEffectMutation,
    removeEffectMutation,
  } = useEncounterSessionData(encounter);

  if (!live) {
    return (
      <p className="text-sm text-stone-500 italic p-4">
        {isDm ? t('encounters.tracker.connectingLive') : t('encounters.tracker.noCharacterYet')}
      </p>
    );
  }

  return (
    <SessionScreen
      encounter={encounter}
      campaignId={campaignId}
      isDm={isDm}
      live={live}
      myCharacterIds={myCharacterIds}
      characters={charactersQuery.data?.characters}
      monsterInstances={monsterInstancesQuery.data?.monsterInstances}
      monsters={bestiaryQuery.data?.monsters}
      expandedParticipantId={expandedParticipantId}
      setExpandedParticipantId={setExpandedParticipantId}
      showDiceRoller={showDiceRoller}
      setShowDiceRoller={setShowDiceRoller}
      startMutation={startMutation}
      endMutation={endMutation}
      startCombatMutation={startCombatMutation}
      endCombatMutation={endCombatMutation}
      dispositionMutation={dispositionMutation}
      forceFullscreenMutation={forceFullscreenMutation}
      rollInitiativeMutation={rollInitiativeMutation}
      advanceTurnMutation={advanceTurnMutation}
      addParticipantMutation={addParticipantMutation}
      removeParticipantMutation={removeParticipantMutation}
      visibilityMutation={visibilityMutation}
      hpMutation={hpMutation}
      applyEffectMutation={applyEffectMutation}
      removeEffectMutation={removeEffectMutation}
      availableCharacters={availableCharacters}
      availableMonsterInstances={availableMonsterInstances}
      fullHeight
    />
  );
}

// Map-first encounter system: the client half of "auto-open and sync" —
// mounted once in CampaignShell.tsx (alongside the existing
// useJoinCampaign), so it's active on every page inside a campaign EXCEPT
// the fullscreen /live/:encounterId route itself (which is deliberately
// outside CampaignShell's tree — see LiveMapPage.tsx). Two triggers:
//   1. On mount/reconnect: "is there a currently-active encounter I should
//      already be in fullscreen for" (GET .../encounters/my-live) — covers
//      reload/reconnect landing directly in the live map.
//      services/encounters.ts's getMyLiveEncounter is the DM-or-owns-a-
//      seated-participant relevance check.
//   2. A live ENCOUNTER_OPENED/ENCOUNTER_FULLSCREEN_FORCED push — the server
//      already targets only relevant sockets (sockets/broadcast.ts's
//      relevantSocketIds), so receiving one at all means "this is for you."
// shouldEnterFullscreen (lib/liveMapState.ts) is the single decision point
// both triggers funnel through, so "respect a minimized flag" / "don't
// interrupt a different live encounter" / "force overrides both" is defined
// exactly once.
//
// Known scope limit: this listener unmounts while actually ON a /live/*
// route (CampaignShell isn't part of that tree), so a second encounter
// opening while a player is already fullscreen in a different one won't
// proactively surface anything until they navigate back into a normal
// campaign page — shouldEnterFullscreen still correctly refuses to interrupt
// them; there just isn't a background badge for the one they're missing yet.
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useSocket } from '../lib/SocketContext';
import { isUuid } from '../lib/ids';
import { shouldEnterFullscreen } from '../lib/liveMapState';
import type { EncounterOpenedEvent } from '../lib/socketTypes';

function currentLiveEncounterId(campaignId: string): string | null {
  const match = window.location.pathname.match(/^\/campaigns\/([^/]+)\/live\/([^/]+)/);
  if (!match || match[1] !== campaignId) return null;
  return match[2]!;
}

export function useLiveMapAutoOpen(campaignId: string): void {
  const navigate = useNavigate();
  const { socket } = useSocket();

  const myLiveQuery = useQuery({
    queryKey: ['myLiveEncounter', campaignId],
    queryFn: () => api.get<{ encounter: { id: string; name: string } | null }>(`/campaigns/${campaignId}/encounters/my-live`),
    enabled: isUuid(campaignId),
    // Checked once per mount (reload/reconnect), not on a poll — a live
    // encounter starting WHILE this page is open arrives via the socket
    // push below instead.
    staleTime: Infinity,
  });

  useEffect(() => {
    const encounter = myLiveQuery.data?.encounter;
    if (!encounter) return;
    if (shouldEnterFullscreen({ targetEncounterId: encounter.id, forced: false, currentLiveEncounterId: currentLiveEncounterId(campaignId) })) {
      navigate(`/campaigns/${campaignId}/live/${encounter.id}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myLiveQuery.data]);

  useEffect(() => {
    function handlePush(payload: EncounterOpenedEvent, forced: boolean) {
      if (payload.campaignId !== campaignId) return;
      if (shouldEnterFullscreen({ targetEncounterId: payload.encounterId, forced, currentLiveEncounterId: currentLiveEncounterId(campaignId) })) {
        navigate(`/campaigns/${payload.campaignId}/live/${payload.encounterId}`);
      }
    }
    function onOpened(payload: EncounterOpenedEvent) {
      handlePush(payload, false);
    }
    function onForced(payload: EncounterOpenedEvent) {
      handlePush(payload, true);
    }
    socket.on('ENCOUNTER_OPENED', onOpened);
    socket.on('ENCOUNTER_FULLSCREEN_FORCED', onForced);
    return () => {
      socket.off('ENCOUNTER_OPENED', onOpened);
      socket.off('ENCOUNTER_FULLSCREEN_FORCED', onForced);
    };
  }, [socket, navigate, campaignId]);
}

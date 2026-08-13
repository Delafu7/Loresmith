// Shared data-fetching + mutations for rendering a live encounter's
// SessionScreen — extracted out of CombatTracker.tsx (the embedded /session
// view) so the new fullscreen LiveMapPage.tsx (map-first encounter system)
// can render the exact same SessionScreen without duplicating this ~150-line
// block of queries and mutations. Both callers own their own outer chrome
// (CombatTracker's card header vs. LiveMapPage's minimal top strip); this
// hook owns only data.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type {
  Character,
  Encounter,
  EncounterDisposition,
  EncounterWithParticipants,
  MonsterCatalogEntry,
  MonsterInstance,
  SnapshotParticipant,
} from '../lib/types';
import { useCampaignShell } from '../campaigns/CampaignShell';
import { useAuth } from '../auth/AuthContext';
import { useEncounterLive, useEncounterPreviewSync } from './useEncounterLive';
import type { ApplyEffectFormInput } from '../components/EffectApplyDialog';

export interface SpawnParticipantsBody {
  monsterId: string;
  quantity: number;
  hpStrategy: 'average' | 'rolled' | 'same';
  groupInitiative: boolean;
  customBaseName?: string;
  namingScheme: 'numeric' | 'alpha';
}

export function useEncounterSessionData(encounter: Encounter) {
  const { campaignId, campaign, role } = useCampaignShell();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isDm = role === 'dm';
  const live = useEncounterLive(encounter.id);
  // GM-only visibility layer — "view as player" preview snapshot.
  const { preview, requestPreviewSync } = useEncounterPreviewSync(encounter.id);
  const [expandedParticipantId, setExpandedParticipantId] = useState<string | null>(null);
  const [showDiceRoller, setShowDiceRoller] = useState(false);

  const detailQuery = useQuery({
    queryKey: ['encounterDetail', encounter.id],
    queryFn: () =>
      api.get<{ encounter: EncounterWithParticipants }>(`/campaigns/${campaignId}/encounters/${encounter.id}`),
  });

  const charactersQuery = useQuery({
    queryKey: ['characters', campaignId],
    queryFn: () => api.get<{ characters: Character[] }>(`/campaigns/${campaignId}/characters`),
  });

  const myCharacterIds = new Set(
    charactersQuery.data?.characters.filter((c) => c.owner_user_id === user?.id).map((c) => c.id) ?? [],
  );
  // Iteration 2 "Character ownership vs. control" — owned ∪ actively
  // delegated-to-me, used for INTERACTIVITY (canMoveToken, resource-spend
  // buttons) instead of raw ownership. myCharacterIds above stays
  // ownership-only (sheet-edit gating, useCharacterEditMode) unchanged.
  const myControlledCharacterIds = new Set(
    charactersQuery.data?.characters
      .filter((c) => (c.controller_user_id ?? c.owner_user_id) === user?.id)
      .map((c) => c.id) ?? [],
  );

  const monsterInstancesQuery = useQuery({
    queryKey: ['monsterInstances', campaignId],
    queryFn: () => api.get<{ monsterInstances: MonsterInstance[] }>(`/campaigns/${campaignId}/monster-instances`),
    enabled: isDm,
  });

  const bestiaryQuery = useQuery({
    queryKey: ['catalog', 'monsters', campaign.srd_edition, campaignId],
    queryFn: () =>
      api.get<{ monsters: MonsterCatalogEntry[] }>(
        `/catalog/monsters?edition=${campaign.srd_edition}&campaignId=${campaignId}`,
      ),
    enabled: isDm,
  });

  function invalidateControlPlane() {
    void queryClient.invalidateQueries({ queryKey: ['encounters', campaignId] });
    void queryClient.invalidateQueries({ queryKey: ['encounterDetail', encounter.id] });
  }

  // Map-first encounter system: 'preparing' -> 'active' is "the GM opens the
  // map" — the server pushes every other relevant player straight into
  // fullscreen (routes/encounters.ts's broadcastEncounterOpened), but the DM's
  // OWN tab benefits from navigating immediately here rather than waiting on
  // the round-trip of receiving its own broadcast back.
  const startMutation = useMutation({
    mutationFn: () => api.post(`/encounters/${encounter.id}/start`),
    onSuccess: () => {
      invalidateControlPlane();
      navigate(`/campaigns/${campaignId}/live/${encounter.id}`);
    },
  });
  const endMutation = useMutation({
    mutationFn: () => api.post(`/encounters/${encounter.id}/end`),
    onSuccess: invalidateControlPlane,
  });
  // Map-first encounter system: the atomic "Start combat" action (rolls
  // initiative + sets the active-participant pointer in one step — see
  // services/encounters.ts's startCombat). "End combat" reuses the existing
  // mode-toggle mutation just below with mode:'exploration'.
  const startCombatMutation = useMutation({
    mutationFn: () => api.post(`/encounters/${encounter.id}/start-combat`),
    onSuccess: invalidateControlPlane,
  });
  const endCombatMutation = useMutation({
    mutationFn: () => api.patch(`/encounters/${encounter.id}/mode`, { mode: 'exploration' }),
    onSuccess: invalidateControlPlane,
  });
  // Encounter-level disposition transition (distinct from a participant's
  // faction) — a POST action, not a raw field edit (see
  // 1784269787666_add-encounter-disposition.ts). No cache write here: the
  // DISPOSITION_CHANGED socket event (which the DM's own action also
  // triggers) patches live.encounter.disposition, same "socket is the
  // single source of truth" discipline as hpMutation above.
  const dispositionMutation = useMutation({
    mutationFn: ({ toDisposition, note }: { toDisposition: EncounterDisposition; note?: string }) =>
      api.post(`/encounters/${encounter.id}/disposition`, { toDisposition, note }),
  });
  // DM control to pull every relevant player back into fullscreen regardless
  // of whether they'd minimized it (map-first encounter system) — no local
  // state change, the push itself is the entire effect.
  const forceFullscreenMutation = useMutation({
    mutationFn: () => api.post(`/encounters/${encounter.id}/force-fullscreen`),
  });
  const rollInitiativeMutation = useMutation({
    mutationFn: (force: boolean) => api.post(`/encounters/${encounter.id}/roll-initiative`, { force }),
    onSuccess: invalidateControlPlane,
  });
  const advanceTurnMutation = useMutation({
    mutationFn: () => api.post(`/encounters/${encounter.id}/advance-turn`),
    onSuccess: invalidateControlPlane,
  });
  const removeParticipantMutation = useMutation({
    mutationFn: (participantId: string) => api.delete(`/encounters/${encounter.id}/participants/${participantId}`),
    onSuccess: invalidateControlPlane,
  });
  const visibilityMutation = useMutation({
    mutationFn: ({ participantId, visible }: { participantId: string; visible: boolean }) =>
      api.patch(`/encounters/${encounter.id}/participants/${participantId}/visibility`, { visible }),
    onSuccess: invalidateControlPlane,
  });
  const addParticipantMutation = useMutation({
    mutationFn: (body: { characterId?: string; monsterInstanceId?: string }) =>
      api.post<{ participant: { id: string } }>(`/encounters/${encounter.id}/participants`, body),
    onSuccess: invalidateControlPlane,
  });
  // Iteration 2 "Fast add/spawn UX" — batched sibling of addParticipantMutation
  // above: one request creates N monster_instances + N combat_participants
  // (see services/spawn.ts) instead of the caller driving N sequential
  // create+seat round-trips. The response's participant ids are only used for
  // AddToEncounterOverlay.tsx's undo action (a follow-up removeParticipantMutation
  // per id) — display state comes from the FULL_STATE_SYNC the server pushes
  // itself, same "socket is the single source of truth" discipline as
  // hpMutation/dispositionMutation above, so no cache write here either.
  const spawnMutation = useMutation({
    mutationFn: (body: SpawnParticipantsBody) =>
      api.post<{ participants: Array<{ id: string }> }>(`/encounters/${encounter.id}/spawn`, body),
    onSuccess: invalidateControlPlane,
  });
  const hpMutation = useMutation({
    mutationFn: ({
      target,
      id,
      delta,
      tempDelta,
    }: {
      target: 'character' | 'monster';
      id: string;
      delta: number;
      tempDelta: number;
    }) =>
      target === 'character'
        ? api.patch(`/characters/${id}/hp`, { delta, tempDelta })
        : api.patch(`/monster-instances/${id}/hp`, { delta, tempDelta }),
    // No cache write here on purpose — HP_CHANGED arriving over the socket
    // (which the DM's own action also triggers) is the single source of
    // truth for combat HP display.
  });
  const applyEffectMutation = useMutation({
    mutationFn: ({ participant, input }: { participant: SnapshotParticipant; input: ApplyEffectFormInput }) =>
      api.post(`/encounters/${encounter.id}/effects`, {
        ...(participant.characterId != null
          ? { characterId: participant.characterId }
          : { monsterInstanceId: participant.monsterInstanceId }),
        effectDefinitionId: input.effectDefinitionId,
        durationValue: input.durationValue,
      }),
  });
  const removeEffectMutation = useMutation({
    mutationFn: (effectId: string) => api.delete(`/effects/${effectId}`),
  });

  const status = live?.encounter.status ?? detailQuery.data?.encounter.status ?? encounter.status;
  const currentRound = live?.encounter.currentRound ?? detailQuery.data?.encounter.current_round ?? encounter.current_round;

  const existingCharacterIds = new Set(
    (live?.participants.map((p) => p.characterId) ?? detailQuery.data?.encounter.participants.map((p) => p.character_id) ?? []).filter(
      (id): id is string => id != null,
    ),
  );
  const existingMonsterInstanceIds = new Set(
    (
      live?.participants.map((p) => p.monsterInstanceId) ??
      detailQuery.data?.encounter.participants.map((p) => p.monster_instance_id) ??
      []
    ).filter((id): id is string => id != null),
  );

  const availableCharacters = (charactersQuery.data?.characters ?? []).filter((c) => !existingCharacterIds.has(c.id));
  const availableMonsterInstances = (monsterInstancesQuery.data?.monsterInstances ?? []).filter(
    (mi) => !existingMonsterInstanceIds.has(mi.id),
  );

  return {
    campaignId,
    isDm,
    live,
    preview,
    requestPreviewSync,
    expandedParticipantId,
    setExpandedParticipantId,
    showDiceRoller,
    setShowDiceRoller,
    charactersQuery,
    monsterInstancesQuery,
    bestiaryQuery,
    myCharacterIds,
    myControlledCharacterIds,
    status,
    currentRound,
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
    spawnMutation,
    hpMutation,
    applyEffectMutation,
    removeEffectMutation,
  };
}

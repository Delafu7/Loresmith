// Player side panel for battle mode (REVISION-PLAN.md §10.2) — a compact,
// read-only-except-for-actions quick-reference: the player's own HP/AC, a
// lightweight turn-action panel (same ACTION_REGISTRY/EconomyPip/DiceRoller
// pattern ActionEconomyPanel.tsx uses for the DM, just without its
// shove/jump/movement extras — this is a battle-mode quick reference, not
// the full DM turn console), a read-only inventory list, and the shared dice
// roller. Always visible for the player's own participant, even out of
// turn — only the action-spend buttons themselves gate on "is it my turn".

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Dispatch, SetStateAction } from 'react';
import { api } from '../lib/api';
import { abilityModifier } from '../lib/dnd-math';
import type { Character, CharacterItem } from '../lib/types';
import { useCampaignShell } from '../campaigns/CampaignShell';
import { useItemsCatalog } from '../lib/useCatalog';
import type { EncounterLiveState } from './useEncounterLive';
import { HPBar } from '../components/HPBar';
import { EmptyState, ErrorBanner, errorMessage } from '../components/Feedback';
import { DiceRoller } from '../components/DiceRoller';
import { QuickDiceRoller } from '../components/QuickDiceRoller';
import { TurnTorch } from '../components/TurnTorch';
import { EconomyPip } from './ActionEconomyPanel';
import { ACTION_REGISTRY, type ActionSlot } from './actionEconomy';
import { ActionButton } from './CombatTracker';

export interface BattleModePlayerPanelProps {
  encounterId: string;
  live: EncounterLiveState;
  myCharacterIds: Set<string>;
  characters: Character[] | undefined;
  showDiceRoller: boolean;
  setShowDiceRoller: Dispatch<SetStateAction<boolean>>;
}

export function BattleModePlayerPanel({
  encounterId,
  live,
  myCharacterIds,
  characters,
  showDiceRoller,
  setShowDiceRoller,
}: BattleModePlayerPanelProps) {
  const participant = live.participants.find((p) => p.characterId != null && myCharacterIds.has(p.characterId));

  if (!participant) {
    return <EmptyState message="You don't have a character in this encounter yet — nothing to show until the DM adds you." />;
  }

  return (
    <PlayerPanelBody
      encounterId={encounterId}
      participant={participant}
      isMyTurn={participant.participantId === live.activeParticipantId}
      character={characters?.find((c) => c.id === participant.characterId)}
      showDiceRoller={showDiceRoller}
      setShowDiceRoller={setShowDiceRoller}
    />
  );
}

// Split out so the "no participant yet" early return above doesn't force
// every hook below into conditional-call territory — this inner component
// only ever mounts once `participant` is known to exist.
function PlayerPanelBody({
  encounterId,
  participant,
  isMyTurn,
  character,
  showDiceRoller,
  setShowDiceRoller,
}: {
  encounterId: string;
  participant: EncounterLiveState['participants'][number];
  isMyTurn: boolean;
  character: Character | undefined;
  showDiceRoller: boolean;
  setShowDiceRoller: Dispatch<SetStateAction<boolean>>;
}) {
  const { campaign } = useCampaignShell();
  const queryClient = useQueryClient();

  const abilityScores = character
    ? { str: character.str, dex: character.dex, con: character.con, int: character.int, wis: character.wis, cha: character.cha }
    : null;

  const spendMutation = useMutation({
    mutationFn: (body: { spend?: ActionSlot; dash?: boolean }) =>
      api.patch(`/encounters/${encounterId}/participants/${participant.participantId}/action-economy`, body),
    // No local cache write — ACTION_ECONOMY_CHANGED over the socket is the
    // source of truth, same discipline as ActionEconomyPanel's own mutation.
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: ['encounterDetail', encounterId] });
    },
  });

  const itemsQuery = useQuery({
    queryKey: ['character', participant.characterId, 'items'],
    queryFn: () => api.get<{ items: CharacterItem[] }>(`/characters/${participant.characterId}/items`),
    enabled: participant.characterId != null,
  });
  const itemsCatalogQuery = useItemsCatalog(campaign.srd_edition);
  const catalogNameById = new Map((itemsCatalogQuery.data?.items ?? []).map((i) => [i.id, i.name]));

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-stone-900 shadow-sm p-3">
        <div className="flex items-center gap-1.5">
          {isMyTurn && <TurnTorch size={18} className="text-amber-500 flex-shrink-0" />}
          <span className="font-semibold text-stone-100 truncate">{participant.name}</span>
        </div>
        <div className="mt-2">
          <HPBar current={participant.hp.hpCurrent} max={participant.hp.hpMax} temp={participant.hp.hpTemp} />
        </div>
        <p className="text-xs text-stone-500 mt-1" title="Armor Class">
          AC {participant.armorClass}
        </p>
      </div>

      <div className="rounded-md bg-stone-900 shadow-sm p-3 space-y-2">
        <h3 className="text-xs uppercase text-stone-500">Actions</h3>
        {!isMyTurn && <p className="text-xs text-stone-500 italic">Not your turn — actions are disabled until it is.</p>}
        <div className="flex flex-wrap items-center gap-1.5">
          <EconomyPip label="Action" used={participant.actionUsed} />
          <EconomyPip label="Bonus Action" used={participant.bonusActionUsed} />
          <EconomyPip label="Reaction" used={participant.reactionUsed} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ACTION_REGISTRY.map((action) => {
            const used =
              action.slot === 'action'
                ? participant.actionUsed
                : action.slot === 'bonus_action'
                  ? participant.bonusActionUsed
                  : participant.reactionUsed;
            const modifier = action.rollTrigger && abilityScores ? abilityModifier(abilityScores[action.rollTrigger.ability]) : 0;
            return (
              <div key={action.key} className="flex items-center gap-1.5">
                <button
                  type="button"
                  title={!isMyTurn ? 'Not your turn' : action.description}
                  disabled={used || !isMyTurn || spendMutation.isPending}
                  onClick={() => spendMutation.mutate({ spend: action.slot, dash: action.isDash })}
                  className="rounded-md border border-stone-700 bg-stone-800 hover:bg-stone-700 disabled:opacity-40 text-stone-200 text-xs px-2 py-1"
                >
                  {action.label}
                </button>
                {action.rollTrigger && abilityScores && (
                  <DiceRoller
                    rollType="ability_check"
                    rollContext={action.rollTrigger.rollContext}
                    modifier={modifier}
                    characterId={participant.characterId ?? undefined}
                    encounterId={encounterId}
                    triggerLabel="🎲"
                  />
                )}
              </div>
            );
          })}
        </div>
        {spendMutation.isError && <ErrorBanner message={errorMessage(spendMutation.error)} />}
      </div>

      <div className="rounded-md bg-stone-900 shadow-sm p-3 space-y-2">
        <h3 className="text-xs uppercase text-stone-500">Inventory</h3>
        {itemsQuery.isLoading && <p className="text-xs text-stone-500 italic">Loading…</p>}
        {itemsQuery.isError && <ErrorBanner message={errorMessage(itemsQuery.error)} />}
        {itemsQuery.data && itemsQuery.data.items.length === 0 && <EmptyState message="No items." />}
        <ul className="space-y-1">
          {itemsQuery.data?.items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2 text-xs text-stone-300">
              <span className="truncate">
                {item.custom_name || catalogNameById.get(item.item_id) || `Item #${item.item_id}`}
                {item.quantity > 1 && <span className="text-stone-500"> ×{item.quantity}</span>}
              </span>
              {item.is_equipped && (
                <span className="text-[10px] uppercase font-semibold text-amber-500 border border-amber-700 rounded px-1 flex-shrink-0">
                  Equipped
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex gap-2">
        <ActionButton onClick={() => setShowDiceRoller((s) => !s)} variant={showDiceRoller ? 'primary' : 'secondary'}>
          {showDiceRoller ? 'Hide dice' : 'Roll dice'}
        </ActionButton>
      </div>
      {showDiceRoller && <QuickDiceRoller encounterId={encounterId} characterId={participant.characterId ?? undefined} />}
    </div>
  );
}

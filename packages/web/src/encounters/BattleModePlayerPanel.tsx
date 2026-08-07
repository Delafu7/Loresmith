// Player side panel for battle mode (REVISION-PLAN.md §10.2) — a compact,
// read-only-except-for-actions quick-reference: the player's own HP/AC, a
// lightweight turn-action panel (same ACTION_REGISTRY/EconomyPip/DiceRoller
// pattern ActionEconomyPanel.tsx uses for the DM, just without its
// shove/jump/movement extras — this is a battle-mode quick reference, not
// the full DM turn console), a read-only inventory list, and the shared dice
// roller. Always visible for the player's own participant, even out of
// turn — only the action-spend buttons themselves gate on "is it my turn".

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type Dispatch, type SetStateAction } from 'react';
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
import { useLocale } from '../i18n/LocaleContext';
import { EconomyPip } from './ActionEconomyPanel';
import { actionDescription, actionLabel } from './actionLabels';
import { ACTION_REGISTRY, type ActionSlot } from './actionEconomy';
import { ActionButton } from './CombatTracker';
import { CastPanel } from './CastPanel';

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
  const { t } = useLocale();
  // A player can control more than one seated character (own PC + a
  // delegated one, or two PCs) — .find() silently hid every character past
  // the first match. Track which one is showing and offer a switcher when
  // there's more than one candidate.
  const myParticipants = live.participants.filter((p) => p.characterId != null && myCharacterIds.has(p.characterId));
  const [selectedParticipantId, setSelectedParticipantId] = useState<string | null>(null);
  const participant =
    myParticipants.find((p) => p.participantId === selectedParticipantId) ?? myParticipants[0];

  if (!participant) {
    return <EmptyState message={t('encounters.tracker.noCharacterYet')} />;
  }

  return (
    <div className="space-y-3">
      {myParticipants.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {myParticipants.map((p) => (
            <button
              key={p.participantId}
              type="button"
              onClick={() => setSelectedParticipantId(p.participantId)}
              className={`rounded-md border px-2 py-1 text-xs font-medium ${
                p.participantId === participant.participantId
                  ? 'border-amber-500 bg-amber-500/10 text-amber-400'
                  : 'border-stone-700 bg-stone-800 text-stone-300 hover:bg-stone-700'
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
      <PlayerPanelBody
        encounterId={encounterId}
        participant={participant}
        allParticipants={live.participants}
        isMyTurn={participant.participantId === live.activeParticipantId}
        character={characters?.find((c) => c.id === participant.characterId)}
        showDiceRoller={showDiceRoller}
        setShowDiceRoller={setShowDiceRoller}
      />
    </div>
  );
}

// Split out so the "no participant yet" early return above doesn't force
// every hook below into conditional-call territory — this inner component
// only ever mounts once `participant` is known to exist.
function PlayerPanelBody({
  encounterId,
  participant,
  allParticipants,
  isMyTurn,
  character,
  showDiceRoller,
  setShowDiceRoller,
}: {
  encounterId: string;
  participant: EncounterLiveState['participants'][number];
  allParticipants: EncounterLiveState['participants'];
  isMyTurn: boolean;
  character: Character | undefined;
  showDiceRoller: boolean;
  setShowDiceRoller: Dispatch<SetStateAction<boolean>>;
}) {
  const { t } = useLocale();
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
        <p className="text-xs text-stone-500 mt-1" title={t('encounters.tracker.armorClass')}>
          AC {participant.armorClass}
        </p>
      </div>

      <div className="rounded-md bg-stone-900 shadow-sm p-3 space-y-2">
        <h3 className="text-xs uppercase text-stone-500">{t('encounters.playerPanel.actionsTitle')}</h3>
        {!isMyTurn && <p className="text-xs text-stone-500 italic">{t('encounters.playerPanel.notYourTurnHint')}</p>}
        <div className="flex flex-wrap items-center gap-1.5">
          <EconomyPip label={t('encounters.actionEconomy.action')} used={participant.actionUsed} />
          <EconomyPip label={t('encounters.actionEconomy.bonusAction')} used={participant.bonusActionUsed} />
          <EconomyPip label={t('encounters.actionEconomy.reaction')} used={participant.reactionUsed} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ACTION_REGISTRY.filter((action) => !action.editions || action.editions.includes(campaign.srd_edition)).map((action) => {
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
                  title={!isMyTurn ? t('encounters.actionEconomy.notYourTurn') : actionDescription(t, action.key)}
                  disabled={used || !isMyTurn || spendMutation.isPending}
                  onClick={() => spendMutation.mutate({ spend: action.slot, dash: action.isDash })}
                  className="rounded-md border border-stone-700 bg-stone-800 hover:bg-stone-700 disabled:opacity-40 text-stone-200 text-xs px-2 py-1"
                >
                  {actionLabel(t, action.key)}
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
        {participant.characterId && (
          <CastPanel encounterId={encounterId} casterCharacterId={participant.characterId} participants={allParticipants} />
        )}
      </div>

      <div className="rounded-md bg-stone-900 shadow-sm p-3 space-y-2">
        <h3 className="text-xs uppercase text-stone-500">{t('encounters.playerPanel.inventoryTitle')}</h3>
        {itemsQuery.isLoading && <p className="text-xs text-stone-500 italic">{t('common.loading')}</p>}
        {itemsQuery.isError && <ErrorBanner message={errorMessage(itemsQuery.error)} />}
        {itemsQuery.data && itemsQuery.data.items.length === 0 && <EmptyState message={t('encounters.playerPanel.noItems')} />}
        <ul className="space-y-1">
          {itemsQuery.data?.items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2 text-xs text-stone-300">
              <span className="truncate">
                {item.custom_name || catalogNameById.get(item.item_id) || t('encounters.tracker.itemFallback', { id: item.item_id })}
                {item.quantity > 1 && <span className="text-stone-500"> ×{item.quantity}</span>}
              </span>
              {item.is_equipped && (
                <span className="text-[10px] uppercase font-semibold text-amber-500 border border-amber-700 rounded px-1 flex-shrink-0">
                  {t('encounters.playerPanel.equipped')}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex gap-2">
        <ActionButton onClick={() => setShowDiceRoller((s) => !s)} variant={showDiceRoller ? 'primary' : 'secondary'}>
          {showDiceRoller ? t('encounters.tracker.hideDice') : t('encounters.tracker.rollDice')}
        </ActionButton>
      </div>
      {showDiceRoller && <QuickDiceRoller encounterId={encounterId} characterId={participant.characterId ?? undefined} />}
    </div>
  );
}

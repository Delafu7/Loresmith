// Player side panel for battle mode (REVISION-PLAN.md §10.2) — a compact,
// read-only-except-for-actions quick-reference: the player's own HP/AC, a
// lightweight turn-action panel (same ACTION_REGISTRY/EconomyPip/DiceRoller
// pattern ActionEconomyPanel.tsx uses for the DM), a Shove/Grapple vs. NPC
// picker (Phase 3 "players act from their own UI" — same
// requireOwnParticipantOrDm-gated routes the DM's own panel uses, minus its
// DM-only defender-roll override field), attacks, spells, a read-only
// inventory list, and the shared dice roller. Still no jump/movement-budget
// extras here — those stay DM-panel-only, a battle-mode quick reference
// doesn't need them. Always visible for the player's own participant, even
// out of turn — only the action-spend buttons themselves gate on "is it my
// turn" (Shove/Grapple included: the server enforces turn order regardless
// of what this client shows).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';
import { abilityModifier } from '../lib/dnd-math';
import type { Character, CharacterItem, GrappleResult, MonsterInstance, PendingActionRequest, ShoveResult } from '../lib/types';
import { useCampaignShell } from '../campaigns/CampaignShell';
import { useItemsCatalog } from '../lib/useCatalog';
import type { EncounterLiveState } from './useEncounterLive';
import { ParticipantHpDisplay } from '../components/ParticipantHpDisplay';
import { EmptyState, ErrorBanner, errorMessage } from '../components/Feedback';
import { DiceRoller } from '../components/DiceRoller';
import { TurnTorch } from '../components/TurnTorch';
import { useLocale } from '../i18n/LocaleContext';
import { EconomyPip } from './ActionEconomyPanel';
import { actionDescription, actionLabel } from './actionLabels';
import { ACTION_REGISTRY, type ActionSlot } from './actionEconomy';
import { CastPanel } from './CastPanel';
import { attackTargetsFor, CharacterAttackRoller } from './AttackRoller';

// UX finding #2 (Iteration 3 audit, live-confirmed) — a player clicking
// Dodge/Help/Hide here only spends the action slot (and, where
// applicable, rolls a check); nothing in the UI used to say so, so the
// button looked exactly as "real" as every other action. Dodge's actual
// condition is applied separately from the DM's own copy of this button
// (see ActionEconomyPanel.tsx's applyDodgeMutation — "conditions are a DM
// tool"); Help/Hide have no automatic effect anywhere in this codebase at
// all, ever — always narratively adjudicated. Shove/Grab don't need this
// marker: their labels already say "(freeform)" and their descriptions
// already explain they apply nothing.
const DECLARES_INTENT_ONLY_KEYS = new Set(['dodge', 'help', 'hide']);

export interface BattleModePlayerPanelProps {
  encounterId: string;
  live: EncounterLiveState;
  myCharacterIds: Set<string>;
  characters: Character[] | undefined;
  monsterInstances: MonsterInstance[] | undefined;
}

export function BattleModePlayerPanel({
  encounterId,
  live,
  myCharacterIds,
  characters,
  monsterInstances,
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
        monsterInstances={monsterInstances}
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
  monsterInstances,
}: {
  encounterId: string;
  participant: EncounterLiveState['participants'][number];
  allParticipants: EncounterLiveState['participants'];
  isMyTurn: boolean;
  character: Character | undefined;
  monsterInstances: MonsterInstance[] | undefined;
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
          <span
            className={`font-semibold text-stone-100 truncate ${isMyTurn ? 'underline decoration-amber-600 decoration-2 underline-offset-2' : ''}`}
          >
            {participant.name}
          </span>
        </div>
        <div className="mt-2">
          <ParticipantHpDisplay hp={participant.hp} size="large" />
        </div>
        <p className="text-xs text-stone-500 mt-1" title={t('encounters.tracker.armorClass')}>
          <span className="font-mono tabular-nums">AC {participant.armorClass}</span>
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
            const declaresIntentOnly = DECLARES_INTENT_ONLY_KEYS.has(action.key);
            const tooltip = !isMyTurn
              ? t('encounters.actionEconomy.notYourTurn')
              : declaresIntentOnly
                ? `${actionDescription(t, action.key)} ${t('encounters.playerPanel.declaresIntentOnlyHint')}`
                : actionDescription(t, action.key);
            return (
              <div key={action.key} className="flex items-center gap-1.5">
                <button
                  type="button"
                  title={tooltip}
                  disabled={used || !isMyTurn || spendMutation.isPending}
                  onClick={() => spendMutation.mutate({ spend: action.slot, dash: action.isDash })}
                  className="rounded-md border border-stone-700 bg-stone-800 hover:bg-stone-700 disabled:opacity-40 text-stone-200 text-xs px-2 py-1"
                >
                  {actionLabel(t, action.key)}
                  {declaresIntentOnly && (
                    <span className="ml-1 text-stone-500" aria-hidden="true">
                      *
                    </span>
                  )}
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
        <p className="text-[10px] text-stone-600">{t('encounters.playerPanel.declaresIntentOnlyLegend')}</p>
        {spendMutation.isError && <ErrorBanner message={errorMessage(spendMutation.error)} />}
        {participant.characterId && (
          <ShoveGrappleControls encounterId={encounterId} participant={participant} otherParticipants={allParticipants} isMyTurn={isMyTurn} />
        )}
        {participant.characterId && (
          <CastPanel encounterId={encounterId} casterCharacterId={participant.characterId} participants={allParticipants} />
        )}
      </div>

      {participant.characterId && (
        <div className="rounded-md bg-stone-900 shadow-sm p-3 space-y-2">
          <h3 className="text-xs uppercase text-stone-500">{t('encounters.playerPanel.attacksTitle')}</h3>
          <CharacterAttackRoller
            characterId={participant.characterId}
            encounterId={encounterId}
            rollerParticipantId={participant.participantId}
            targets={attackTargetsFor(allParticipants, participant.participantId, monsterInstances)}
          />
        </div>
      )}

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

    </div>
  );
}

// Shove/Grapple vs. NPC (Phase 3 "players act from their own UI") — a
// trimmed player-facing version of ActionEconomyPanel.tsx's DM shove/grapple
// sections: same target list (NPC participants only), same skill-choice/
// outcome selects, but with NO defender-roll-override field — overriding an
// NPC's own contested roll is a DM narrative tool, not something a player
// should be able to do to their own advantage. Hits the same
// requireOwnParticipantOrDm-gated routes the DM panel uses; the server
// enforces turn order and control regardless of what this component shows.
function ShoveGrappleControls({
  encounterId,
  participant,
  otherParticipants,
  isMyTurn,
}: {
  encounterId: string;
  participant: EncounterLiveState['participants'][number];
  otherParticipants: EncounterLiveState['participants'];
  isMyTurn: boolean;
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const targets = otherParticipants.filter((p) => p.monsterInstanceId !== null);

  const [shoveTargetId, setShoveTargetId] = useState<string | ''>('');
  const [desiredEffect, setDesiredEffect] = useState<'push_5ft' | 'knock_prone'>('push_5ft');
  const [shoveDefenderSkill, setShoveDefenderSkill] = useState<'athletics' | 'acrobatics'>('athletics');

  const [grappleTargetId, setGrappleTargetId] = useState<string | ''>('');
  const [grappleDefenderSkill, setGrappleDefenderSkill] = useState<'athletics' | 'acrobatics'>('athletics');

  const shoveMutation = useMutation({
    mutationFn: (body: { targetParticipantId: string; desiredEffect: 'push_5ft' | 'knock_prone'; defenderSkill: 'athletics' | 'acrobatics' }) =>
      api.post<ShoveResult | { pending: true; request: PendingActionRequest }>(
        `/encounters/${encounterId}/participants/${participant.participantId}/shove`,
        body,
      ),
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: ['encounterDetail', encounterId] });
    },
  });

  const grappleMutation = useMutation({
    mutationFn: (body: { targetParticipantId: string; defenderSkill: 'athletics' | 'acrobatics' }) =>
      api.post<GrappleResult | { pending: true; request: PendingActionRequest }>(
        `/encounters/${encounterId}/participants/${participant.participantId}/grapple`,
        body,
      ),
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: ['encounterDetail', encounterId] });
    },
  });

  if (targets.length === 0) return null;

  return (
    <div className="space-y-3 border-t border-stone-800 pt-2">
      <div className="flex flex-col gap-1.5 text-xs text-stone-400">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-stone-500">{t('encounters.actionEconomy.shoveNpc')}</span>
          <select
            value={shoveTargetId}
            onChange={(e) => setShoveTargetId(e.target.value)}
            className="rounded-md border border-stone-700 bg-stone-800 px-1.5 py-1 text-stone-200"
          >
            <option value="">{t('encounters.actionEconomy.selectTarget')}</option>
            {targets.map((target) => (
              <option key={target.participantId} value={target.participantId}>
                {target.name}
              </option>
            ))}
          </select>
          <select
            value={shoveDefenderSkill}
            onChange={(e) => setShoveDefenderSkill(e.target.value as 'athletics' | 'acrobatics')}
            className="rounded-md border border-stone-700 bg-stone-800 px-1.5 py-1 text-stone-200"
          >
            <option value="athletics">{t('encounters.actionEconomy.defendsAthletics')}</option>
            <option value="acrobatics">{t('encounters.actionEconomy.defendsAcrobatics')}</option>
          </select>
          <select
            value={desiredEffect}
            onChange={(e) => setDesiredEffect(e.target.value as 'push_5ft' | 'knock_prone')}
            className="rounded-md border border-stone-700 bg-stone-800 px-1.5 py-1 text-stone-200"
          >
            <option value="push_5ft">{t('encounters.actionEconomy.push5ft')}</option>
            <option value="knock_prone">{t('encounters.actionEconomy.knockProne')}</option>
          </select>
          <button
            type="button"
            title={!isMyTurn ? t('encounters.actionEconomy.notYourTurn') : undefined}
            disabled={shoveTargetId === '' || shoveMutation.isPending}
            onClick={() => {
              if (shoveTargetId === '') return;
              shoveMutation.mutate({ targetParticipantId: shoveTargetId, desiredEffect, defenderSkill: shoveDefenderSkill });
            }}
            className="rounded-md border border-stone-700 bg-stone-800 hover:bg-stone-700 disabled:opacity-40 text-stone-200 px-2 py-1"
          >
            {t('encounters.actionEconomy.shove')}
          </button>
        </div>
        {shoveMutation.data && 'pending' in shoveMutation.data && (
          <div className="rounded-md border border-amber-800/60 text-amber-500 px-2 py-1">{t('encounters.pendingActions.submitted')}</div>
        )}
        {shoveMutation.data && !('pending' in shoveMutation.data) && (
          <div className={`rounded-md border px-2 py-1 ${shoveMutation.data.success ? 'border-green-800 text-green-400' : 'border-red-800 text-red-400'}`}>
            <div>{shoveMutation.data.message}</div>
            <div className="text-stone-500">
              {t('encounters.actionEconomy.attackerRolled', { roll: shoveMutation.data.attackerRoll.result_total })}
              {t('encounters.actionEconomy.vsSeparator')}
              {t('encounters.actionEconomy.defenderRolled', { total: shoveMutation.data.defenderTotal })}
            </div>
          </div>
        )}
        {shoveMutation.isError && <ErrorBanner message={errorMessage(shoveMutation.error)} />}
      </div>

      <div className="flex flex-col gap-1.5 text-xs text-stone-400">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-stone-500">{t('encounters.actionEconomy.grappleNpc')}</span>
          <select
            value={grappleTargetId}
            onChange={(e) => setGrappleTargetId(e.target.value)}
            className="rounded-md border border-stone-700 bg-stone-800 px-1.5 py-1 text-stone-200"
          >
            <option value="">{t('encounters.actionEconomy.selectTarget')}</option>
            {targets.map((target) => (
              <option key={target.participantId} value={target.participantId}>
                {target.name}
              </option>
            ))}
          </select>
          <select
            value={grappleDefenderSkill}
            onChange={(e) => setGrappleDefenderSkill(e.target.value as 'athletics' | 'acrobatics')}
            className="rounded-md border border-stone-700 bg-stone-800 px-1.5 py-1 text-stone-200"
          >
            <option value="athletics">{t('encounters.actionEconomy.defendsAthletics')}</option>
            <option value="acrobatics">{t('encounters.actionEconomy.defendsAcrobatics')}</option>
          </select>
          <button
            type="button"
            title={!isMyTurn ? t('encounters.actionEconomy.notYourTurn') : undefined}
            disabled={grappleTargetId === '' || grappleMutation.isPending}
            onClick={() => {
              if (grappleTargetId === '') return;
              grappleMutation.mutate({ targetParticipantId: grappleTargetId, defenderSkill: grappleDefenderSkill });
            }}
            className="rounded-md border border-stone-700 bg-stone-800 hover:bg-stone-700 disabled:opacity-40 text-stone-200 px-2 py-1"
          >
            {t('encounters.actionEconomy.grapple')}
          </button>
        </div>
        {grappleMutation.data && 'pending' in grappleMutation.data && (
          <div className="rounded-md border border-amber-800/60 text-amber-500 px-2 py-1">{t('encounters.pendingActions.submitted')}</div>
        )}
        {grappleMutation.data && !('pending' in grappleMutation.data) && (
          <div className={`rounded-md border px-2 py-1 ${grappleMutation.data.success ? 'border-green-800 text-green-400' : 'border-red-800 text-red-400'}`}>
            <div>{grappleMutation.data.message}</div>
            <div className="text-stone-500">
              {t('encounters.actionEconomy.attackerRolled', { roll: grappleMutation.data.attackerRoll.result_total })}
              {t('encounters.actionEconomy.vsSeparator')}
              {t('encounters.actionEconomy.defenderRolled', { total: grappleMutation.data.defenderTotal })}
            </div>
          </div>
        )}
        {grappleMutation.isError && <ErrorBanner message={errorMessage(grappleMutation.error)} />}
      </div>
    </div>
  );
}

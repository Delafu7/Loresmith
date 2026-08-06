// DM side panel (nav point 3 merge) — the single roster/control panel used
// at EVERY encounter status now, not just 'active'. Folds in everything the
// old separate "prep-mode roster" in CombatTracker.tsx had that this panel
// didn't yet (HP adjustment, effects, the visibility toggle, remove-
// participant, and the active participant's ActionEconomyPanel) so there's
// one DM panel, not two drifting implementations for prep vs. combat. Every
// mutation/query here is owned by CombatTracker and threaded through as
// props — this file never fetches or mutates anything on its own.

import type { Dispatch, SetStateAction } from 'react';
import type { Character, EncounterDisposition, EncounterStatus, MonsterCatalogEntry, MonsterInstance, SnapshotParticipant } from '../lib/types';
import type { ApplyEffectFormInput } from '../components/EffectApplyDialog';
import type { EncounterLiveState } from './useEncounterLive';
import { HPBar } from '../components/HPBar';
import { HpAdjustForm } from '../components/HpAdjustForm';
import { EffectBadge } from '../components/EffectBadge';
import { EffectApplyDialog } from '../components/EffectApplyDialog';
import { EmptyState } from '../components/Feedback';
import { QuickDiceRoller } from '../components/QuickDiceRoller';
import { TurnTorch } from '../components/TurnTorch';
import { DispositionControl } from './DispositionPanel';
import { useLocale } from '../i18n/LocaleContext';
import { useEffectDefinitionsCatalog } from '../lib/useCatalog';
import { useAuth } from '../auth/AuthContext';
import { useCampaignShell } from '../campaigns/CampaignShell';
import { ActionEconomyPanel } from './ActionEconomyPanel';
import { CONTROL_BADGE_DOT_COLOR, controlBadgeFor, controlBadgeLabel } from './controlBadge';
import {
  ActionButton,
  ParticipantStatLookup,
  ParticipantWeaknessReveal,
  ResetRevealsButton,
  resolveAbilityScores,
} from './CombatTracker';

// Structural (not TanStack's own UseMutationResult<...>) on purpose — this
// panel only ever calls `.mutate(...)`/reads `.isPending` on whichever
// mutation objects CombatTracker hands it, so a minimal shape keeps this
// file decoupled from the exact TData/TError generics those mutations
// happen to infer.
export interface MutationLike<TVariables = void> {
  mutate: (variables: TVariables) => void;
  isPending: boolean;
}

export interface BattleModeDmPanelProps {
  encounterId: string;
  status: EncounterStatus;
  live: EncounterLiveState;
  characters: Character[] | undefined;
  monsterInstances: MonsterInstance[] | undefined;
  monsters: MonsterCatalogEntry[] | undefined;
  expandedParticipantId: string | null;
  setExpandedParticipantId: Dispatch<SetStateAction<string | null>>;
  showDiceRoller: boolean;
  setShowDiceRoller: Dispatch<SetStateAction<boolean>>;
  startMutation: MutationLike<void>;
  endMutation: MutationLike<void>;
  startCombatMutation: MutationLike<void>;
  endCombatMutation: MutationLike<void>;
  dispositionMutation: MutationLike<{ toDisposition: EncounterDisposition; note?: string }>;
  forceFullscreenMutation: MutationLike<void>;
  rollInitiativeMutation: MutationLike<boolean>;
  advanceTurnMutation: MutationLike<void>;
  removeParticipantMutation: MutationLike<string>;
  visibilityMutation: MutationLike<{ participantId: string; visible: boolean }>;
  hpMutation: MutationLike<{ target: 'character' | 'monster'; id: string; delta: number; tempDelta: number }>;
  applyEffectMutation: MutationLike<{ participant: SnapshotParticipant; input: ApplyEffectFormInput }>;
  removeEffectMutation: MutationLike<string>;
}

export function BattleModeDmPanel({
  encounterId,
  status,
  live,
  characters,
  monsterInstances,
  monsters,
  expandedParticipantId,
  setExpandedParticipantId,
  showDiceRoller,
  setShowDiceRoller,
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
  hpMutation,
  applyEffectMutation,
  removeEffectMutation,
}: BattleModeDmPanelProps) {
  const { t } = useLocale();
  const { user } = useAuth();
  const { campaign } = useCampaignShell();
  const effectDefinitionsQuery = useEffectDefinitionsCatalog(campaign.id);
  const activeParticipant = live.participants.find((p) => p.participantId === live.activeParticipantId);

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-stone-900 shadow-sm p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs uppercase text-stone-500">
            {status === 'preparing'
              ? t(`encounters.status.${status}`)
              : live.encounter.mode === 'combat'
                ? t('encounters.tracker.round', { round: live.encounter.currentRound })
                : t('encounters.battleMode.mode.exploration')}
          </p>
        </div>
        {live.encounter.mode === 'combat' && (
          <div className="flex items-center gap-1.5 mt-1">
            <TurnTorch size={18} className="text-amber-500 flex-shrink-0" />
            <span className="font-semibold text-stone-100 truncate">
              {activeParticipant ? activeParticipant.name : t('encounters.tracker.waitingForInitiative')}
            </span>
          </div>
        )}
      </div>

      <DispositionControl
        disposition={live.encounter.disposition}
        pending={dispositionMutation.isPending}
        onTransition={(toDisposition, note) => dispositionMutation.mutate({ toDisposition, note })}
      />

      <ol className="space-y-1.5">
        {live.participants.map((p) => {
          const isActive = p.participantId === live.activeParticipantId;
          const controlBadge = controlBadgeFor(p.characterId, characters, user?.id);
          return (
            <li
              key={p.participantId}
              className={`rounded-md border p-2 text-xs ${
                isActive ? 'border-amber-600 bg-amber-950/20' : 'border-stone-800 bg-stone-900'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  {isActive && <TurnTorch size={14} className="text-amber-500 flex-shrink-0" />}
                  {controlBadge && (
                    <span
                      title={controlBadgeLabel(t, controlBadge)}
                      aria-label={controlBadgeLabel(t, controlBadge)}
                      className={`h-2 w-2 flex-shrink-0 rounded-full ${CONTROL_BADGE_DOT_COLOR[controlBadge]}`}
                    />
                  )}
                  <span className="font-medium text-stone-100 truncate">{p.name}</span>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <span className="text-stone-500 border border-stone-700 rounded px-1" title={t('encounters.tracker.armorClass')}>
                    AC {p.armorClass}
                  </span>
                  {p.monsterInstanceId != null && <ParticipantWeaknessReveal monsterInstanceId={p.monsterInstanceId} />}
                  <button
                    type="button"
                    onClick={() => visibilityMutation.mutate({ participantId: p.participantId, visible: !p.visibleToPlayers })}
                    disabled={visibilityMutation.isPending}
                    aria-label={
                      p.visibleToPlayers
                        ? t('encounters.tracker.hideFromPlayers', { name: p.name })
                        : t('encounters.tracker.revealToPlayers', { name: p.name })
                    }
                    title={
                      p.visibleToPlayers
                        ? t('encounters.tracker.hideFromPlayers', { name: p.name })
                        : t('encounters.tracker.revealToPlayers', { name: p.name })
                    }
                    className={`inline-flex h-6 w-6 items-center justify-center disabled:opacity-50 ${
                      p.visibleToPlayers ? 'text-stone-400 hover:text-stone-200' : 'text-amber-500 hover:text-amber-400'
                    }`}
                  >
                    {p.visibleToPlayers ? '👁' : '🙈'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpandedParticipantId((id) => (id === p.participantId ? null : p.participantId))}
                    aria-expanded={expandedParticipantId === p.participantId}
                    aria-label={
                      expandedParticipantId === p.participantId
                        ? t('encounters.tracker.hideStats', { name: p.name })
                        : t('encounters.tracker.viewStats', { name: p.name })
                    }
                    title={t('encounters.tracker.viewFullStats')}
                    className="inline-flex h-6 w-6 items-center justify-center text-stone-400 hover:text-stone-200"
                  >
                    {expandedParticipantId === p.participantId ? '▾' : '▸'}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeParticipantMutation.mutate(p.participantId)}
                    className="inline-flex h-6 w-6 items-center justify-center text-red-400 hover:text-red-300"
                    aria-label={t('encounters.tracker.removeParticipant', { name: p.name })}
                  >
                    ✕
                  </button>
                </div>
              </div>
              <div className="mt-1.5">
                <HPBar current={p.hp.hpCurrent} max={p.hp.hpMax} temp={p.hp.hpTemp} />
              </div>
              {expandedParticipantId === p.participantId && (
                <>
                  <ParticipantStatLookup
                    participant={p}
                    characters={characters}
                    monsterInstances={monsterInstances}
                    monsters={monsters}
                    encounterId={encounterId}
                    allParticipants={live.participants}
                  />
                  <div className="mt-2">
                    <HpAdjustForm
                      compact
                      disabled={hpMutation.isPending}
                      onApply={(delta, tempDelta) =>
                        hpMutation.mutate({
                          target: p.characterId != null ? 'character' : 'monster',
                          id: (p.characterId ?? p.monsterInstanceId)!,
                          delta,
                          tempDelta,
                        })
                      }
                    />
                  </div>
                </>
              )}
              <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                {p.effects.map((effect) => (
                  <EffectBadge
                    key={effect.effectId}
                    effect={effect}
                    removable
                    onRemove={() => removeEffectMutation.mutate(effect.effectId)}
                  />
                ))}
                <EffectApplyDialog
                  effectDefinitions={effectDefinitionsQuery.data?.effectDefinitions ?? []}
                  pending={applyEffectMutation.isPending}
                  onApply={(input) => applyEffectMutation.mutate({ participant: p, input })}
                />
              </div>
              {isActive && (
                <ActionEconomyPanel
                  encounterId={encounterId}
                  participant={p}
                  abilityScores={resolveAbilityScores(p, characters, monsterInstances, monsters)}
                  otherParticipants={live.participants.filter((other) => other.participantId !== p.participantId)}
                />
              )}
            </li>
          );
        })}
        {live.participants.length === 0 && <EmptyState message={t('encounters.tracker.noParticipantsYet')} />}
      </ol>

      <div className="flex flex-wrap gap-2">
        {status === 'preparing' && (
          <ActionButton onClick={() => startMutation.mutate()} pending={startMutation.isPending}>
            {t('encounters.tracker.startEncounter')}
          </ActionButton>
        )}
        {status === 'active' && live.encounter.mode === 'exploration' && (
          <ActionButton onClick={() => startCombatMutation.mutate()} pending={startCombatMutation.isPending}>
            {t('encounters.tracker.startCombat')}
          </ActionButton>
        )}
        {live.encounter.mode === 'combat' && (
          <>
            <ActionButton onClick={() => advanceTurnMutation.mutate()} pending={advanceTurnMutation.isPending}>
              {t('encounters.tracker.advanceTurn')}
            </ActionButton>
            <ActionButton onClick={() => rollInitiativeMutation.mutate(true)} pending={rollInitiativeMutation.isPending} variant="secondary">
              {t('encounters.tracker.rerollInitiative')}
            </ActionButton>
            <ActionButton onClick={() => endCombatMutation.mutate()} pending={endCombatMutation.isPending} variant="secondary">
              {t('encounters.tracker.endCombat')}
            </ActionButton>
          </>
        )}
        {status === 'active' && (
          <ActionButton
            onClick={() => forceFullscreenMutation.mutate()}
            pending={forceFullscreenMutation.isPending}
            variant="secondary"
          >
            {t('encounters.live.forceFullscreen')}
          </ActionButton>
        )}
        {status !== 'preparing' && (
          <ActionButton onClick={() => endMutation.mutate()} pending={endMutation.isPending} variant="danger">
            {t('encounters.tracker.endEncounter')}
          </ActionButton>
        )}
      </div>

      <div className="flex gap-2 items-center justify-between">
        <ActionButton onClick={() => setShowDiceRoller((s) => !s)} variant={showDiceRoller ? 'primary' : 'secondary'}>
          {showDiceRoller ? t('encounters.tracker.hideDice') : t('encounters.tracker.rollDice')}
        </ActionButton>
        <ResetRevealsButton encounterId={encounterId} />
      </div>
      {showDiceRoller && <QuickDiceRoller encounterId={encounterId} />}
    </div>
  );
}

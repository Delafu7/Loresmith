import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { abilityModifier } from '../lib/dnd-math';
import { DiceRoller } from '../components/DiceRoller';
import { ErrorBanner, errorMessage } from '../components/Feedback';
import { ACTION_REGISTRY, highJumpDistanceFt, jumpDistanceFt, standUpCostFt, type ActionSlot } from './actionEconomy';
import type { ShoveResult, SnapshotParticipant } from '../lib/types';
import { useLocale } from '../i18n/LocaleContext';
import { actionDescription, actionLabel } from './actionLabels';

type AbilityScores = Record<'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha', number>;

export function EconomyPip({ label, used }: { label: string; used: boolean }) {
  return (
    <span
      className={`text-[10px] uppercase rounded px-1.5 py-0.5 border ${
        used ? 'border-stone-800 text-stone-600 line-through' : 'border-amber-700 text-amber-500'
      }`}
    >
      {label}
    </span>
  );
}

/**
 * Turn-action UI for whichever participant is currently active (Phase 3.6).
 * Purely a thin renderer over ACTION_REGISTRY — spending a slot is a single
 * generic PATCH, and any action with a rollTrigger gets a DiceRoller placed
 * right next to its spend button (mirrors InventoryPanel's Attack+Damage
 * pairing: two independent triggers, not one combined action). DM-only,
 * same as every other combat_participants mutation in this app.
 */
export function ActionEconomyPanel({
  encounterId,
  participant,
  abilityScores,
  otherParticipants,
}: {
  encounterId: string;
  participant: SnapshotParticipant;
  abilityScores: AbilityScores | null;
  /** Every other live participant, for the Shove-vs-NPC target picker below —
   * NPC targets (monsterInstanceId set) are the only valid choices. */
  otherParticipants: SnapshotParticipant[];
}) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(true);
  const [moveFeet, setMoveFeet] = useState('');
  const [difficultTerrain, setDifficultTerrain] = useState(false);

  const shoveTargets = otherParticipants.filter((p) => p.monsterInstanceId !== null);
  const [shoveTargetId, setShoveTargetId] = useState<string | ''>('');
  const [desiredEffect, setDesiredEffect] = useState<'push_5ft' | 'knock_prone'>('push_5ft');
  const [defenderSkill, setDefenderSkill] = useState<'athletics' | 'acrobatics'>('athletics');
  const [defenderOverride, setDefenderOverride] = useState('');

  const spendMutation = useMutation({
    mutationFn: (body: { spend?: ActionSlot | 'object_interaction'; dash?: boolean; addMovementFt?: number }) =>
      api.patch(`/encounters/${encounterId}/participants/${participant.participantId}/action-economy`, body),
    // No local cache write — ACTION_ECONOMY_CHANGED over the socket is the
    // source of truth, same discipline as CombatTracker's hpMutation/
    // applyEffectMutation.
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: ['encounterDetail', encounterId] });
    },
  });

  // REFACTOR-PLAN.md §5 ("allow the DM to undo") — restores exactly whatever
  // the last spend touched (see docs/rules/actions.md §2.4); DM-only,
  // separate from the player-or-DM spend endpoint above.
  const undoMutation = useMutation({
    mutationFn: () => api.post(`/encounters/${encounterId}/participants/${participant.participantId}/action-economy/undo`),
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: ['encounterDetail', encounterId] });
    },
  });

  // Standing up from prone both spends movement and ends the condition, so
  // it fires two independent requests — same "two independent triggers"
  // shape as the roll-trigger buttons above, just both mutating state
  // instead of one mutating and one just rolling.
  const removeEffectMutation = useMutation({
    mutationFn: (effectId: string) => api.delete(`/effects/${effectId}`),
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: ['encounterDetail', encounterId] });
    },
  });

  // Shove Check Against a Specific NPC — unlike every other button in this
  // panel, the response IS read directly (attackerRoll/defenderRoll/outcome)
  // since there's no other way to surface "both rolls + who won" to the DM;
  // ACTION_ECONOMY_CHANGED over the socket still handles the actionUsed pip.
  const shoveMutation = useMutation({
    mutationFn: (body: { targetParticipantId: string; desiredEffect: 'push_5ft' | 'knock_prone'; defenderSkill: 'athletics' | 'acrobatics'; defenderRollOverride?: number }) =>
      api.post<ShoveResult>(`/encounters/${encounterId}/participants/${participant.participantId}/shove`, body),
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: ['encounterDetail', encounterId] });
    },
  });

  const speed = participant.speedFt ?? 30;
  const movementBudget = speed * (participant.dashUsed ? 2 : 1);
  const movementRemaining = Math.max(0, movementBudget - participant.movementUsedFt);
  const longJumpDistance = abilityScores ? jumpDistanceFt(abilityScores.str, running) : null;
  const highJumpDistance = abilityScores ? highJumpDistanceFt(abilityModifier(abilityScores.str), running) : null;
  const longJumpFeasible = longJumpDistance !== null && longJumpDistance <= movementRemaining;
  const highJumpFeasible = highJumpDistance !== null && highJumpDistance <= movementRemaining;
  const proneEffect = participant.effects.find((e) => e.name.toLowerCase() === 'prone');
  const standUpCost = standUpCostFt(speed);

  const moveFeetParsed = Number(moveFeet);
  const moveCost = Number.isFinite(moveFeetParsed) && moveFeetParsed > 0 ? moveFeetParsed * (difficultTerrain ? 2 : 1) : null;
  const moveDisabled = moveCost === null || moveCost > movementRemaining || spendMutation.isPending;

  return (
    <div className="mt-2 pt-2 border-t border-stone-800 space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <EconomyPip label={t('encounters.actionEconomy.action')} used={participant.actionUsed} />
        <EconomyPip label={t('encounters.actionEconomy.bonusAction')} used={participant.bonusActionUsed} />
        <EconomyPip label={t('encounters.actionEconomy.reaction')} used={participant.reactionUsed} />
        <EconomyPip label={t('encounters.actionEconomy.object')} used={participant.objectInteractionUsed} />
        <span className="text-[10px] uppercase text-stone-500 border border-stone-800 rounded px-1.5 py-0.5">
          {t('encounters.actionEconomy.movement', { remaining: movementRemaining, budget: movementBudget })}
        </span>
        <button
          type="button"
          title={t('encounters.actionEconomy.undoTitle')}
          disabled={undoMutation.isPending}
          onClick={() => undoMutation.mutate()}
          className="text-[10px] uppercase text-stone-500 hover:text-amber-400 border border-stone-800 hover:border-amber-700 rounded px-1.5 py-0.5 disabled:opacity-40"
        >
          {t('encounters.actionEconomy.undoLast')}
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          title={t('encounters.actionEconomy.freeObjectInteractionTitle')}
          disabled={participant.objectInteractionUsed || spendMutation.isPending}
          onClick={() => spendMutation.mutate({ spend: 'object_interaction' })}
          className="rounded-md border border-stone-700 bg-stone-800 hover:bg-stone-700 disabled:opacity-40 text-stone-200 text-xs px-2 py-1"
        >
          {t('encounters.actionEconomy.freeObjectInteraction')}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {ACTION_REGISTRY.map((action) => {
          const used =
            action.slot === 'action'
              ? participant.actionUsed
              : action.slot === 'bonus_action'
                ? participant.bonusActionUsed
                : participant.reactionUsed;
          const modifier =
            action.rollTrigger && abilityScores ? abilityModifier(abilityScores[action.rollTrigger.ability]) : 0;
          return (
            <div key={action.key} className="flex items-center gap-1.5">
              <button
                type="button"
                title={actionDescription(t, action.key)}
                disabled={used || spendMutation.isPending}
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
                  monsterInstanceId={participant.monsterInstanceId ?? undefined}
                  encounterId={encounterId}
                  triggerLabel="🎲"
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-stone-400">
        <span className="text-stone-500">{t('encounters.actionEconomy.moveLabel')}</span>
        <input
          type="number"
          min={1}
          value={moveFeet}
          onChange={(e) => setMoveFeet(e.target.value)}
          placeholder={t('encounters.actionEconomy.feetPlaceholder')}
          className="w-16 rounded-md border border-stone-700 bg-stone-800 px-1.5 py-1 text-stone-200"
        />
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={difficultTerrain} onChange={(e) => setDifficultTerrain(e.target.checked)} />
          {t('encounters.actionEconomy.difficultTerrain')}
        </label>
        {moveCost !== null && <span>{t('encounters.actionEconomy.moveCostEquals', { cost: moveCost })}</span>}
        <button
          type="button"
          disabled={moveDisabled}
          onClick={() => {
            if (moveCost !== null) {
              spendMutation.mutate({ addMovementFt: moveCost });
              setMoveFeet('');
            }
          }}
          className="rounded-md border border-stone-700 bg-stone-800 hover:bg-stone-700 disabled:opacity-40 text-stone-200 px-2 py-1"
        >
          {t('encounters.actionEconomy.spendMovement')}
        </button>
      </div>

      {proneEffect && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-stone-400">
          <span className="text-stone-500">{t('encounters.actionEconomy.proneLabel')}</span>
          <span>{t('encounters.actionEconomy.standUpCost', { cost: standUpCost })}</span>
          <button
            type="button"
            disabled={standUpCost > movementRemaining || spendMutation.isPending || removeEffectMutation.isPending}
            onClick={() => {
              spendMutation.mutate({ addMovementFt: standUpCost });
              removeEffectMutation.mutate(proneEffect.effectId);
            }}
            className="rounded-md border border-stone-700 bg-stone-800 hover:bg-stone-700 disabled:opacity-40 text-stone-200 px-2 py-1"
          >
            {t('encounters.actionEconomy.standUp')}
          </button>
        </div>
      )}

      {participant.characterId !== null && shoveTargets.length > 0 && (
        <div className="flex flex-col gap-1.5 text-xs text-stone-400 border-t border-stone-800 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-stone-500">{t('encounters.actionEconomy.shoveNpc')}</span>
            <select
              value={shoveTargetId}
              onChange={(e) => setShoveTargetId(e.target.value)}
              className="rounded-md border border-stone-700 bg-stone-800 px-1.5 py-1 text-stone-200"
            >
              <option value="">{t('encounters.actionEconomy.selectTarget')}</option>
              {shoveTargets.map((target) => (
                <option key={target.participantId} value={target.participantId}>
                  {target.name}
                </option>
              ))}
            </select>
            <select
              value={defenderSkill}
              onChange={(e) => setDefenderSkill(e.target.value as 'athletics' | 'acrobatics')}
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
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1">
              {t('encounters.actionEconomy.dmOverride')}
              <input
                type="number"
                value={defenderOverride}
                onChange={(e) => setDefenderOverride(e.target.value)}
                placeholder={t('encounters.actionEconomy.autoRoll')}
                className="w-20 rounded-md border border-stone-700 bg-stone-800 px-1.5 py-1 text-stone-200"
              />
            </label>
            <button
              type="button"
              disabled={participant.actionUsed || shoveTargetId === '' || shoveMutation.isPending}
              onClick={() => {
                if (shoveTargetId === '') return;
                const overrideParsed = Number(defenderOverride);
                shoveMutation.mutate({
                  targetParticipantId: shoveTargetId,
                  desiredEffect,
                  defenderSkill,
                  defenderRollOverride: defenderOverride !== '' && Number.isFinite(overrideParsed) ? overrideParsed : undefined,
                });
              }}
              className="rounded-md border border-stone-700 bg-stone-800 hover:bg-stone-700 disabled:opacity-40 text-stone-200 px-2 py-1"
            >
              {t('encounters.actionEconomy.shove')}
            </button>
          </div>
          {shoveMutation.data && (
            <div className={`rounded-md border px-2 py-1 ${shoveMutation.data.success ? 'border-green-800 text-green-400' : 'border-red-800 text-red-400'}`}>
              <div>{shoveMutation.data.message}</div>
              <div className="text-stone-500">
                {t('encounters.actionEconomy.attackerRolled', { roll: shoveMutation.data.attackerRoll.result_total })}
                {t('encounters.actionEconomy.vsSeparator')}
                {shoveMutation.data.defenderOverridden
                  ? t('encounters.actionEconomy.dmSetTotal', { total: shoveMutation.data.defenderTotal })
                  : t('encounters.actionEconomy.defenderRolled', { total: shoveMutation.data.defenderTotal })}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs text-stone-400">
        <span className="text-stone-500">{t('encounters.actionEconomy.jumpLabel')}</span>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={running} onChange={(e) => setRunning(e.target.checked)} />
          {t('encounters.actionEconomy.runningStart')}
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-stone-400 pl-2">
        <span className="text-stone-500">{t('encounters.actionEconomy.longJump')}</span>
        {longJumpDistance !== null && <span>{t('encounters.actionEconomy.feet', { distance: longJumpDistance })}</span>}
        {longJumpDistance !== null && !longJumpFeasible && (
          <span className="text-red-500">{t('encounters.actionEconomy.notEnoughMovement')}</span>
        )}
        <button
          type="button"
          disabled={longJumpDistance === null || !longJumpFeasible || spendMutation.isPending}
          onClick={() => longJumpDistance !== null && spendMutation.mutate({ addMovementFt: longJumpDistance })}
          className="rounded-md border border-stone-700 bg-stone-800 hover:bg-stone-700 disabled:opacity-40 text-stone-200 px-2 py-1"
        >
          {t('encounters.actionEconomy.useMovementToJump')}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-stone-400 pl-2">
        <span className="text-stone-500">{t('encounters.actionEconomy.highJump')}</span>
        {highJumpDistance !== null && <span>{t('encounters.actionEconomy.feet', { distance: highJumpDistance })}</span>}
        {highJumpDistance !== null && !highJumpFeasible && (
          <span className="text-red-500">{t('encounters.actionEconomy.notEnoughMovement')}</span>
        )}
        <button
          type="button"
          disabled={highJumpDistance === null || !highJumpFeasible || spendMutation.isPending}
          onClick={() => highJumpDistance !== null && spendMutation.mutate({ addMovementFt: highJumpDistance })}
          className="rounded-md border border-stone-700 bg-stone-800 hover:bg-stone-700 disabled:opacity-40 text-stone-200 px-2 py-1"
        >
          {t('encounters.actionEconomy.useMovementToJump')}
        </button>
      </div>

      {spendMutation.isError && <ErrorBanner message={errorMessage(spendMutation.error)} />}
      {removeEffectMutation.isError && <ErrorBanner message={errorMessage(removeEffectMutation.error)} />}
      {shoveMutation.isError && <ErrorBanner message={errorMessage(shoveMutation.error)} />}
    </div>
  );
}

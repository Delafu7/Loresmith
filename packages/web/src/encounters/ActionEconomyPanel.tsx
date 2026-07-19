import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { abilityModifier } from '../lib/dnd-math';
import { DiceRoller } from '../components/DiceRoller';
import { ErrorBanner, errorMessage } from '../components/Feedback';
import { ACTION_REGISTRY, jumpDistanceFt, type ActionSlot } from './actionEconomy';
import type { SnapshotParticipant } from '../lib/types';

type AbilityScores = Record<'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha', number>;

function EconomyPip({ label, used }: { label: string; used: boolean }) {
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
}: {
  encounterId: number;
  participant: SnapshotParticipant;
  abilityScores: AbilityScores | null;
}) {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(true);

  const spendMutation = useMutation({
    mutationFn: (body: { spend?: ActionSlot; dash?: boolean; addMovementFt?: number }) =>
      api.patch(`/encounters/${encounterId}/participants/${participant.participantId}/action-economy`, body),
    // No local cache write — ACTION_ECONOMY_CHANGED over the socket is the
    // source of truth, same discipline as CombatTracker's hpMutation/
    // applyEffectMutation.
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: ['encounterDetail', encounterId] });
    },
  });

  const speed = participant.speedFt ?? 30;
  const movementBudget = speed * (participant.dashUsed ? 2 : 1);
  const movementRemaining = Math.max(0, movementBudget - participant.movementUsedFt);
  const jumpDistance = abilityScores ? jumpDistanceFt(abilityScores.str, running) : null;

  return (
    <div className="mt-2 pt-2 border-t border-stone-800 space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <EconomyPip label="Action" used={participant.actionUsed} />
        <EconomyPip label="Bonus Action" used={participant.bonusActionUsed} />
        <EconomyPip label="Reaction" used={participant.reactionUsed} />
        <span className="text-[10px] uppercase text-stone-500 border border-stone-800 rounded px-1.5 py-0.5">
          Movement {movementRemaining}/{movementBudget} ft
        </span>
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
                title={action.description}
                disabled={used || spendMutation.isPending}
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
        <span className="text-stone-500">Jump:</span>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={running} onChange={(e) => setRunning(e.target.checked)} />
          Running start
        </label>
        {jumpDistance !== null && <span>{jumpDistance} ft</span>}
        <button
          type="button"
          disabled={jumpDistance === null || spendMutation.isPending}
          onClick={() => jumpDistance !== null && spendMutation.mutate({ addMovementFt: jumpDistance })}
          className="rounded-md border border-stone-700 bg-stone-800 hover:bg-stone-700 disabled:opacity-40 text-stone-200 px-2 py-1"
        >
          Use movement to jump
        </button>
      </div>

      {spendMutation.isError && <ErrorBanner message={errorMessage(spendMutation.error)} />}
    </div>
  );
}

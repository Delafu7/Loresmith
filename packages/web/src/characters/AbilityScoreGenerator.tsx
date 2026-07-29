import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { ErrorBanner, errorMessage } from '../components/Feedback';
import {
  ABILITY_KEYS,
  POINT_BUY_BUDGET,
  POINT_BUY_MAX,
  POINT_BUY_MIN,
  STANDARD_ARRAY,
  pointBuyTotalCost,
  type AbilityKey,
} from './abilityScoreGeneration';
import type { AbilityScoreRollSet } from '../lib/types';
import { useLocale, type TranslationKey } from '../i18n/LocaleContext';

type Method = 'manual' | 'standard_array' | 'point_buy' | 'roll';

const METHOD_LABEL_KEYS: Record<Method, TranslationKey> = {
  manual: 'characters.abilityGenerator.methods.manual',
  standard_array: 'characters.abilityGenerator.methods.standardArray',
  point_buy: 'characters.abilityGenerator.methods.pointBuy',
  roll: 'characters.abilityGenerator.methods.roll',
};

/**
 * Ability-score generation helper for the character creation form
 * (CharactersListPage.tsx). The six manual number inputs there stay the
 * canonical, always-editable fields — this component is purely a filler:
 * pick a method, generate/assign values, hit "Apply" to write them into the
 * parent's form state. Switching back to Manual afterward just leaves
 * whatever was last applied in place for hand-tweaking.
 */
export function AbilityScoreGenerator({
  campaignId,
  allowReroll,
  onApply,
}: {
  campaignId: string;
  allowReroll: boolean;
  onApply: (scores: Record<AbilityKey, number>) => void;
}) {
  const { t } = useLocale();
  const [method, setMethod] = useState<Method>('manual');
  const [assignments, setAssignments] = useState<Partial<Record<AbilityKey, number>>>({});
  const [pointBuy, setPointBuy] = useState<Record<AbilityKey, number>>({
    str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8,
  });
  const [rolledSets, setRolledSets] = useState<AbilityScoreRollSet[] | null>(null);
  const [hasRolledOnce, setHasRolledOnce] = useState(false);

  const rollMutation = useMutation({
    mutationFn: () => api.post<{ sets: AbilityScoreRollSet[] }>(`/campaigns/${campaignId}/roll-ability-scores`),
    onSuccess: (data) => {
      setRolledSets(data.sets);
      setHasRolledOnce(true);
      setAssignments({});
    },
  });

  function assignPoolIndex(key: AbilityKey, indexStr: string) {
    setAssignments((prev) => {
      const next = { ...prev };
      if (indexStr === '') delete next[key];
      else next[key] = Number(indexStr);
      return next;
    });
  }

  const pool = method === 'standard_array' ? STANDARD_ARRAY : rolledSets ? rolledSets.map((s) => s.total) : null;
  const allAssigned = pool !== null && ABILITY_KEYS.every((key) => assignments[key] !== undefined);
  const pointBuyCost = pointBuyTotalCost(pointBuy);
  const pointBuyRemaining = POINT_BUY_BUDGET - pointBuyCost;

  return (
    <div className="rounded-md border border-stone-800 bg-stone-950/40 p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs uppercase text-stone-500">{t('characters.abilityGenerator.generateScores')}</span>
        {(Object.keys(METHOD_LABEL_KEYS) as Method[]).map((m) => (
          <label key={m} className="flex items-center gap-1 text-xs text-stone-300">
            <input type="radio" checked={method === m} onChange={() => setMethod(m)} />
            {t(METHOD_LABEL_KEYS[m])}
          </label>
        ))}
      </div>

      {method === 'standard_array' && (
        <PoolAssignment pool={STANDARD_ARRAY} assignments={assignments} onAssign={assignPoolIndex} />
      )}

      {method === 'roll' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => rollMutation.mutate()}
              disabled={rollMutation.isPending || (hasRolledOnce && !allowReroll)}
              className="rounded-md border border-stone-700 bg-stone-800 hover:bg-stone-700 disabled:opacity-40 text-stone-200 px-2 py-1 text-xs"
            >
              {rollMutation.isPending
                ? t('characters.abilityGenerator.rolling')
                : hasRolledOnce
                  ? t('characters.abilityGenerator.reroll')
                  : t('characters.abilityGenerator.rollScores')}
            </button>
            {hasRolledOnce && !allowReroll && (
              <span className="text-xs text-stone-500">{t('characters.abilityGenerator.rerollDisabled')}</span>
            )}
          </div>
          {rollMutation.isError && <ErrorBanner message={errorMessage(rollMutation.error)} />}
          {rolledSets && (
            <>
              <div className="flex flex-wrap gap-2">
                {rolledSets.map((set, idx) => (
                  <div key={idx} className="rounded-md border border-stone-700 bg-stone-900 px-2 py-1 text-xs">
                    <div className="text-stone-500">
                      {set.dice.map((d, i) => (
                        <span key={i} className={i === set.droppedIndex ? 'line-through text-stone-600' : ''}>
                          {d}
                          {i < set.dice.length - 1 ? ', ' : ''}
                        </span>
                      ))}
                    </div>
                    <div className="text-stone-100 font-semibold">= {set.total}</div>
                  </div>
                ))}
              </div>
              <PoolAssignment pool={rolledSets.map((s) => s.total)} assignments={assignments} onAssign={assignPoolIndex} />
            </>
          )}
        </div>
      )}

      {method === 'point_buy' && (
        <div className="space-y-2">
          <div className="text-xs text-stone-400">
            {t('characters.abilityGenerator.pointsRemaining')}{' '}
            <span className={pointBuyRemaining < 0 ? 'text-red-400' : 'text-stone-100'}>{pointBuyRemaining}</span> /{' '}
            {POINT_BUY_BUDGET}
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {ABILITY_KEYS.map((key) => (
              <div key={key} className="flex flex-col items-center gap-1">
                <span className="text-xs uppercase text-stone-500">{key}</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={pointBuy[key] <= POINT_BUY_MIN}
                    onClick={() => setPointBuy((p) => ({ ...p, [key]: p[key] - 1 }))}
                    className="w-6 h-6 rounded border border-stone-700 text-stone-300 disabled:opacity-30"
                  >
                    −
                  </button>
                  <span className="w-6 text-center text-stone-100 text-sm">{pointBuy[key]}</span>
                  <button
                    type="button"
                    disabled={pointBuy[key] >= POINT_BUY_MAX}
                    onClick={() => setPointBuy((p) => ({ ...p, [key]: p[key] + 1 }))}
                    className="w-6 h-6 rounded border border-stone-700 text-stone-300 disabled:opacity-30"
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {method !== 'manual' && (
        <button
          type="button"
          disabled={method === 'point_buy' ? pointBuyRemaining < 0 : !allAssigned}
          onClick={() => {
            if (method === 'point_buy') {
              onApply(pointBuy);
            } else if (pool) {
              const scores = {} as Record<AbilityKey, number>;
              for (const key of ABILITY_KEYS) {
                scores[key] = pool[assignments[key]!]!;
              }
              onApply(scores);
            }
          }}
          className="rounded-md border border-amber-500 text-amber-500 hover:bg-amber-500/10 active:bg-amber-500/20 disabled:opacity-45 disabled:cursor-not-allowed font-semibold px-3 py-1.5 text-xs"
        >
          {t('characters.abilityGenerator.applyToCharacter')}
        </button>
      )}
    </div>
  );
}

function PoolAssignment({
  pool,
  assignments,
  onAssign,
}: {
  pool: number[];
  assignments: Partial<Record<AbilityKey, number>>;
  onAssign: (key: AbilityKey, indexStr: string) => void;
}) {
  const usedIndices = new Set(Object.values(assignments));
  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
      {ABILITY_KEYS.map((key) => {
        const current = assignments[key];
        return (
          <div key={key} className="flex flex-col items-center gap-1">
            <span className="text-xs uppercase text-stone-500">{key}</span>
            <select
              value={current ?? ''}
              onChange={(e) => onAssign(key, e.target.value)}
              className="w-full rounded-md bg-stone-800 border border-stone-700 px-1 py-1 text-stone-100 text-center text-xs"
            >
              <option value="">—</option>
              {pool.map((value, idx) => (current === idx || !usedIndices.has(idx)) && (
                <option key={idx} value={idx}>
                  {value}
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </div>
  );
}

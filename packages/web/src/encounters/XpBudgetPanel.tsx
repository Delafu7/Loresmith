// Phase 3 "encounter XP budgeting" — DM-only planning readout (see
// services/encounters.ts's getEncounterXpBudget header comment for why this
// is DM-only: difficulty is meta-game info the DM may not want players to
// see ahead of a fight). Edition-aware display over the two structurally
// different result shapes domain/xpBudget.ts returns — see
// docs/rules/encounter-xp-budget.md for the rules this renders.
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Loading, errorMessage } from '../components/Feedback';
import { useLocale } from '../i18n/LocaleContext';

interface XpBudgetResult2014 {
  edition: '2014';
  tier: 'trivial' | 'easy' | 'medium' | 'hard' | 'deadly';
  partyThresholds: { easy: number; medium: number; hard: number; deadly: number };
  monsterCount: number;
  rawMonsterXp: number;
  multiplier: number;
  adjustedMonsterXp: number;
}

interface XpBudgetResult2024 {
  edition: '2024';
  tier: 'trivial' | 'low' | 'moderate' | 'high';
  partyBudgets: { low: number; moderate: number; high: number };
  monsterCount: number;
  monsterXpTotal: number;
}

type XpBudgetResult = XpBudgetResult2014 | XpBudgetResult2024;

const TIER_COLOR: Record<XpBudgetResult['tier'], string> = {
  trivial: 'text-stone-400',
  easy: 'text-emerald-400',
  low: 'text-emerald-400',
  medium: 'text-amber-400',
  moderate: 'text-amber-400',
  hard: 'text-orange-400',
  high: 'text-orange-400',
  deadly: 'text-red-400',
};

export function XpBudgetPanel({ campaignId, encounterId }: { campaignId: string; encounterId: string }) {
  const { t } = useLocale();
  const query = useQuery({
    queryKey: ['encounter', encounterId, 'xp-budget'],
    queryFn: () => api.get<{ xpBudget: XpBudgetResult }>(`/campaigns/${campaignId}/encounters/${encounterId}/xp-budget`),
    // A DM might open this panel before any PC has been seated yet — the
    // service throws in that case (see getEncounterXpBudget), which is an
    // expected/unremarkable state here, not a real error to alarm over.
    retry: false,
  });

  const budget = query.data?.xpBudget;

  return (
    <div className="rounded-md bg-stone-900 shadow-sm p-3 space-y-1.5">
      <h4 className="text-xs uppercase text-stone-500">{t('encounters.xpBudget.title')}</h4>
      {query.isLoading && <Loading />}
      {/* The most common "error" here is just "no PC seated yet" (services/
          encounters.ts's getEncounterXpBudget throws a plain validation
          message for that case) — shown as quiet italic hint text, not an
          alarming ErrorBanner, since it's an expected state while a DM is
          still building the encounter. */}
      {query.isError && <p className="text-xs text-stone-500 italic">{errorMessage(query.error)}</p>}
      {budget && (
        <>
          <p className={`text-sm font-semibold capitalize ${TIER_COLOR[budget.tier]}`}>{t(`encounters.xpBudget.tier.${budget.tier}`)}</p>
          {budget.edition === '2014' ? (
            <div className="text-xs text-stone-400 space-y-0.5">
              <p>
                {t('encounters.xpBudget.monsterXp2014', {
                  raw: budget.rawMonsterXp,
                  multiplier: budget.multiplier,
                  adjusted: budget.adjustedMonsterXp,
                })}
              </p>
              <p>
                {t('encounters.xpBudget.thresholds2014', {
                  easy: budget.partyThresholds.easy,
                  medium: budget.partyThresholds.medium,
                  hard: budget.partyThresholds.hard,
                  deadly: budget.partyThresholds.deadly,
                })}
              </p>
            </div>
          ) : (
            <div className="text-xs text-stone-400 space-y-0.5">
              <p>{t('encounters.xpBudget.monsterXp2024', { total: budget.monsterXpTotal })}</p>
              <p>
                {t('encounters.xpBudget.thresholds2024', {
                  low: budget.partyBudgets.low,
                  moderate: budget.partyBudgets.moderate,
                  high: budget.partyBudgets.high,
                })}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

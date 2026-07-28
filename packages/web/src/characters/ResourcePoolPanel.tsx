import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useCharacterResources, useResourcePoolMutations, resourcesQueryKey } from './useResourcePools';
import { ErrorBanner, errorMessage } from '../components/Feedback';

// Spell-slot rows get their own dedicated tracker (SpellcastingPanel) — this
// panel is deliberately everything else (second_wind, ki_points, rage_uses,
// lay_on_hands_pool, ...).
const SPELL_RELATED_RE = /^(spell_slot_|warlock_pact_slot_)/;

function poolLabel(resourceKey: string): string {
  return resourceKey.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Generic resource-pool tracker (PLAN.md §6.2's ResourcePoolPanel) plus
 * per-character rest buttons. POST /campaigns/:id/rests is DM-only
 * server-side (routes/rests.ts) — rest buttons are gated to the DM here to
 * match, rather than rendering a control that would just 403.
 */
export function ResourcePoolPanel({
  characterId,
  campaignId,
  editable,
  isDm,
}: {
  characterId: string;
  campaignId: string;
  editable: boolean;
  isDm: boolean;
}) {
  const queryClient = useQueryClient();
  const resourcesQuery = useCharacterResources(characterId);
  const { spend, recover } = useResourcePoolMutations(characterId);
  const [spendAmount, setSpendAmount] = useState<Record<string, string>>({});

  const restMutation = useMutation({
    mutationFn: (restType: 'short' | 'long') =>
      api.post(`/campaigns/${campaignId}/rests`, { restType, characterIds: [characterId] }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: resourcesQueryKey(characterId) });
      // A long rest also resets hp_current -> hp_max on the character row
      // itself (services/rests.ts) — refresh that too so the HP panel above
      // doesn't show stale pre-rest HP.
      void queryClient.invalidateQueries({ queryKey: ['character', characterId], exact: true });
    },
  });

  const pools = (resourcesQuery.data?.resources ?? []).filter((r) => !SPELL_RELATED_RE.test(r.resource_key));

  if (resourcesQuery.isLoading) return null;

  return (
    <section className="rounded-md bg-stone-900 shadow-sm p-4 sm:p-5 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Resources</h3>
        {isDm && (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={restMutation.isPending}
              onClick={() => restMutation.mutate('short')}
              className="text-xs rounded-md bg-stone-800 hover:bg-stone-700 border border-stone-700 text-stone-100 px-2 py-1 disabled:opacity-60"
            >
              Short rest
            </button>
            <button
              type="button"
              disabled={restMutation.isPending}
              onClick={() => restMutation.mutate('long')}
              className="text-xs rounded-md border border-amber-500 text-amber-500 hover:bg-amber-500/10 active:bg-amber-500/20 disabled:opacity-45 disabled:cursor-not-allowed font-semibold px-2 py-1 disabled:opacity-60"
            >
              Long rest
            </button>
          </div>
        )}
      </div>

      {pools.length === 0 ? (
        <p className="text-stone-500 text-sm italic">No tracked resources.</p>
      ) : (
        <ul className="grid sm:grid-cols-2 gap-2">
          {pools.map((pool) => (
            <li key={pool.resource_key} className="rounded-md border border-stone-700 bg-stone-950 p-3">
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-stone-300">{poolLabel(pool.resource_key)}</span>
                <span className="font-medium text-stone-100">
                  {pool.current_value}/{pool.max_value}
                </span>
              </div>
              <div className="text-[10px] text-stone-600 uppercase mb-2">Recharges on {pool.recharge_on.replace('_', ' ')}</div>
              {editable && (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    placeholder="1"
                    value={spendAmount[pool.resource_key] ?? ''}
                    onChange={(e) => setSpendAmount((m) => ({ ...m, [pool.resource_key]: e.target.value }))}
                    aria-label={`${poolLabel(pool.resource_key)} amount`}
                    className="w-14 rounded-md bg-stone-800 border border-stone-700 px-2 py-1 text-xs text-stone-100"
                  />
                  <button
                    type="button"
                    disabled={spend.isPending || pool.current_value <= 0}
                    onClick={() =>
                      spend.mutate({ resourceKey: pool.resource_key, amount: Number(spendAmount[pool.resource_key]) || 1 })
                    }
                    className="rounded-md bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-xs font-medium px-2 py-1"
                  >
                    Spend
                  </button>
                  <button
                    type="button"
                    disabled={recover.isPending || pool.current_value >= pool.max_value}
                    onClick={() =>
                      recover.mutate({ resourceKey: pool.resource_key, amount: Number(spendAmount[pool.resource_key]) || 1 })
                    }
                    className="rounded-md bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-medium px-2 py-1"
                  >
                    Recover
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {(spend.isError || recover.isError || restMutation.isError) && (
        <ErrorBanner message={errorMessage((spend.error ?? recover.error ?? restMutation.error) as unknown)} />
      )}
    </section>
  );
}

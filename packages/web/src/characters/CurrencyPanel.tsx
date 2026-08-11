import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { CharacterCurrency } from '../lib/types';
import { ErrorBanner, errorMessage } from '../components/Feedback';
import { useLocale } from '../i18n/LocaleContext';

const DENOMINATIONS = ['cp', 'sp', 'ep', 'gp', 'pp'] as const;
type Denomination = (typeof DENOMINATIONS)[number];

function currencyQueryKey(characterId: string) {
  return ['character', characterId, 'currency'] as const;
}

/**
 * Currency tracker (Phase 1.5) — the app had no coin tracking at all before
 * this. Same "controlled inputs, commit on blur" idiom as
 * ParticipantSheetPanel.tsx's InitiativeEditor, one input per denomination
 * rather than a single free-text purse field so cp/sp/ep/gp/pp stay
 * independently correctable.
 */
export function CurrencyPanel({ characterId, editable }: { characterId: string; editable: boolean }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Partial<Record<Denomination, string>>>({});

  const currencyQuery = useQuery({
    queryKey: currencyQueryKey(characterId),
    queryFn: () => api.get<{ currency: CharacterCurrency }>(`/characters/${characterId}/currency`),
  });

  const updateMutation = useMutation({
    mutationFn: (patch: Partial<Record<Denomination, number>>) =>
      api.patch<{ currency: CharacterCurrency }>(`/characters/${characterId}/currency`, patch),
    onSuccess: (data) => {
      queryClient.setQueryData(currencyQueryKey(characterId), data);
    },
  });

  if (currencyQuery.isLoading || !currencyQuery.data) return null;
  const currency = currencyQuery.data.currency;

  function commit(denom: Denomination) {
    const raw = drafts[denom];
    if (raw === undefined) return;
    const value = Math.max(0, Math.trunc(Number(raw)) || 0);
    setDrafts((d) => ({ ...d, [denom]: undefined }));
    if (value === currency[denom]) return;
    updateMutation.mutate({ [denom]: value });
  }

  return (
    <section className="rounded-md bg-stone-900 shadow-sm p-4 sm:p-5 space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500">{t('characters.currency.title')}</h3>
      <ul className="grid grid-cols-5 gap-2">
        {DENOMINATIONS.map((denom) => (
          <li key={denom} className="rounded-md border border-stone-700 bg-stone-950 p-2 text-center">
            <label htmlFor={`currency-${characterId}-${denom}`} className="block text-[10px] uppercase text-stone-500 mb-1">
              {t(`characters.currency.${denom}`)}
            </label>
            {editable ? (
              <input
                id={`currency-${characterId}-${denom}`}
                type="number"
                min={0}
                step={1}
                value={drafts[denom] ?? currency[denom]}
                onChange={(e) => setDrafts((d) => ({ ...d, [denom]: e.target.value }))}
                onBlur={() => commit(denom)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
                className="w-full rounded-md bg-stone-800 border border-stone-700 px-1 py-1 text-sm text-stone-100 text-center tabular-nums"
              />
            ) : (
              <span className="block font-mono font-semibold text-stone-100 tabular-nums">{currency[denom]}</span>
            )}
          </li>
        ))}
      </ul>
      {updateMutation.isError && <ErrorBanner message={errorMessage(updateMutation.error)} />}
    </section>
  );
}

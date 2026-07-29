import { useState } from 'react';
import type { EffectDefinitionCatalog } from '../lib/types';
import { useLocale } from '../i18n/LocaleContext';

export interface ApplyEffectFormInput {
  effectDefinitionId: string;
  durationValue: number | null;
}

// DM-only "apply an effect/condition" control (PLAN.md §6.2's
// EffectApplyDialog). No headless-dialog primitive is installed in this repo
// (package.json has no Radix/React Aria dependency despite PLAN.md §2's
// aspiration), so — matching Phase 1's own AddParticipantForm/
// ClassSummaryPanel precedent of an inline expand/collapse form rather than
// a true overlay — this renders as a collapsible inline panel, not a modal.
export function EffectApplyDialog({
  effectDefinitions,
  pending,
  onApply,
}: {
  effectDefinitions: EffectDefinitionCatalog[];
  pending?: boolean;
  onApply: (input: ApplyEffectFormInput) => void;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [effectDefinitionId, setEffectDefinitionId] = useState('');
  const [durationValue, setDurationValue] = useState('');

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={effectDefinitions.length === 0}
        className="text-xs text-amber-500 hover:text-amber-400 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {t('effects.addEffect')}
      </button>
    );
  }

  function reset() {
    setOpen(false);
    setEffectDefinitionId('');
    setDurationValue('');
  }

  function submit() {
    if (!effectDefinitionId) return;
    onApply({
      effectDefinitionId,
      durationValue: durationValue.trim() === '' ? null : Number(durationValue),
    });
    reset();
  }

  return (
    <div className="rounded-md border border-stone-700 bg-stone-950 p-2 flex flex-wrap items-end gap-2">
      <div>
        <label className="block text-[10px] text-stone-500 mb-0.5" htmlFor="effect-select">
          {t('effects.effect')}
        </label>
        <select
          id="effect-select"
          value={effectDefinitionId}
          onChange={(e) => setEffectDefinitionId(e.target.value)}
          className="rounded-md bg-stone-800 border border-stone-700 px-2 py-1 text-xs text-stone-100 min-w-[9rem]"
        >
          <option value="">{t('effects.select')}</option>
          {effectDefinitions.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-[10px] text-stone-500 mb-0.5" htmlFor="effect-duration">
          {t('effects.durationOverride')}
        </label>
        <input
          id="effect-duration"
          type="number"
          min={0}
          placeholder={t('effects.default')}
          value={durationValue}
          onChange={(e) => setDurationValue(e.target.value)}
          className="w-20 rounded-md bg-stone-800 border border-stone-700 px-2 py-1 text-xs text-stone-100"
        />
      </div>
      <button
        type="button"
        disabled={!effectDefinitionId || pending}
        onClick={submit}
        className="rounded-md border border-amber-500 text-amber-500 hover:bg-amber-500/10 active:bg-amber-500/20 disabled:opacity-45 disabled:cursor-not-allowed font-semibold px-2 py-1 text-xs"
      >
        {t('effects.apply')}
      </button>
      <button
        type="button"
        onClick={reset}
        className="rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-800"
      >
        {t('common.cancel')}
      </button>
    </div>
  );
}

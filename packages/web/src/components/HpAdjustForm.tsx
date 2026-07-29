import { useState, type FormEvent } from 'react';
import { useLocale } from '../i18n/LocaleContext';

// Shared damage/heal control — calls the signed-delta PATCH .../hp endpoint
// (never an absolute value) per PLAN.md §4.1. Reused by the character sheet
// HP panel and the combat tracker's per-participant HP control.
export function HpAdjustForm({
  onApply,
  disabled,
  compact = false,
}: {
  onApply: (delta: number, tempDelta: number) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const { t } = useLocale();
  const [amount, setAmount] = useState('');
  const [tempAmount, setTempAmount] = useState('');

  function apply(sign: 1 | -1, e?: FormEvent) {
    e?.preventDefault();
    const n = Number(amount);
    if (!amount || Number.isNaN(n) || n <= 0) return;
    onApply(sign * n, 0);
    setAmount('');
  }

  function applyTemp(e: FormEvent) {
    e.preventDefault();
    const n = Number(tempAmount);
    if (!tempAmount || Number.isNaN(n) || n <= 0) return;
    onApply(0, n);
    setTempAmount('');
  }

  return (
    <div className={`flex flex-wrap items-end gap-2 ${compact ? '' : 'mt-2'}`}>
      <form onSubmit={(e) => apply(-1, e)} className="flex items-end gap-1">
        <div>
          <label className="sr-only" htmlFor="hp-amount">
            {t('hpAdjust.amount')}
          </label>
          <input
            id="hp-amount"
            type="number"
            min={1}
            inputMode="numeric"
            placeholder={t('hpAdjust.amount')}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={disabled}
            className="w-24 rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-stone-100 text-sm disabled:opacity-50"
          />
        </div>
        <button
          type="submit"
          disabled={disabled}
          className="rounded-md bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium px-3 py-1.5 min-h-[2.25rem]"
        >
          {t('hpAdjust.damage')}
        </button>
        <button
          type="button"
          onClick={() => apply(1)}
          disabled={disabled}
          className="rounded-md bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-medium px-3 py-1.5 min-h-[2.25rem]"
        >
          {t('hpAdjust.heal')}
        </button>
      </form>
      <form onSubmit={applyTemp} className="flex items-end gap-1">
        <input
          type="number"
          min={1}
          inputMode="numeric"
          placeholder={t('hpAdjust.tempHp')}
          value={tempAmount}
          onChange={(e) => setTempAmount(e.target.value)}
          disabled={disabled}
          className="w-24 rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-stone-100 text-sm disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabled}
          className="rounded-md bg-sky-700 hover:bg-sky-600 disabled:opacity-50 text-white text-sm font-medium px-3 py-1.5 min-h-[2.25rem]"
        >
          {t('hpAdjust.setTemp')}
        </button>
      </form>
    </div>
  );
}

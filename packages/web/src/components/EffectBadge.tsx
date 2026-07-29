import type { ActiveEffectSummary } from '../lib/types';
import { useLocale } from '../i18n/LocaleContext';

// Shared primitive (PLAN.md §6.4) — renders one active effect/condition.
// Reused by the combat tracker's per-participant effect list and the
// character sheet's outside-combat active-effects section.
export function EffectBadge({
  effect,
  onRemove,
  removable = false,
}: {
  effect: ActiveEffectSummary;
  onRemove?: () => void;
  removable?: boolean;
}) {
  const { t } = useLocale();
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-violet-800 bg-violet-950/50 px-2 py-0.5 text-xs text-violet-300">
      {effect.concentration && (
        <span title={t('effects.requiresConcentration')} aria-label={t('effects.concentration')} className="text-violet-400">
          ◆
        </span>
      )}
      <span className="truncate max-w-[8rem]">{effect.name}</span>
      {effect.durationType === 'rounds' && effect.durationRemaining != null && (
        <span className="text-violet-500">({effect.durationRemaining}r)</span>
      )}
      {removable && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={t('effects.remove', { name: effect.name })}
          className="text-violet-400 hover:text-violet-200 leading-none"
        >
          ✕
        </button>
      )}
    </span>
  );
}

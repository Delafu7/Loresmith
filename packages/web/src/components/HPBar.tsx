import { useLocale } from '../i18n/LocaleContext';
import type { HpBand } from '../lib/types';

// Decorative status label only (Healthy/Injured/.../Down) — computed
// client-side from the always-visible exact HP numbers. Not related to
// combat_participants.hp_visibility (Phase 2's reintroduced per-participant
// exact/banded/hidden mode, see ParticipantHpDisplay.tsx) — this component
// is used everywhere HP numbers are simply always visible regardless of
// that mechanic (character sheets, dashboard, monster stat blocks): those
// endpoints don't redact HP at all. `HpBand` (lib/types.ts) is shared with
// that mechanic purely so the two don't invent two vocabularies for the
// same five-way split — only the displayed label is translated, via i18n's
// `hp.*` keys.
export const HP_BAND_COLOR: Record<HpBand, string> = {
  healthy: 'bg-emerald-600',
  injured: 'bg-yellow-600',
  bloodied: 'bg-orange-600',
  critical: 'bg-red-600',
  down: 'bg-stone-700',
};

const BAND_TEXT: Record<HpBand, string> = {
  healthy: 'text-emerald-400',
  injured: 'text-yellow-400',
  bloodied: 'text-orange-400',
  critical: 'text-red-400',
  down: 'text-stone-400',
};

export const HP_BAND_KEY = {
  healthy: 'hp.healthy',
  injured: 'hp.injured',
  bloodied: 'hp.bloodied',
  critical: 'hp.critical',
  down: 'hp.down',
} as const;

/**
 * Exact-HP variant: current/max numeric bar with a temp-HP overlay segment.
 * `size="large"` (Field Ledger visual pass, staged rollout — CharacterSheetPage
 * only for now) makes the number the dominant element on screen, matching
 * "combat numbers stay the most prominent thing on screen"; every other
 * existing call site keeps today's compact size unchanged, still getting the
 * font-mono/tabular-nums legibility win with no layout risk.
 */
export function HPBar({
  current,
  max,
  temp = 0,
  size = 'compact',
}: {
  current: number;
  max: number;
  temp?: number;
  size?: 'compact' | 'large';
}) {
  const { t } = useLocale();
  const pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
  const tempPct = max > 0 ? Math.max(0, Math.min(100 - pct, (temp / max) * 100)) : 0;
  const band = bandFor(current, max);

  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between mb-1">
        {/* Mono for unambiguous, column-aligned digits — the app's one
            legibility-first typographic choice for combat numbers. */}
        <span
          className={`font-mono font-bold text-stone-100 tabular-nums ${size === 'large' ? 'text-2xl sm:text-3xl' : 'text-sm'}`}
        >
          {current} / {max}
          {temp > 0 && (
            <span className={`text-sky-400 font-medium ${size === 'large' ? 'text-base sm:text-lg' : 'text-sm'}`}> (+{temp})</span>
          )}
        </span>
        <span className={`text-[11px] font-semibold uppercase tracking-wide ${BAND_TEXT[band]}`}>{t(HP_BAND_KEY[band])}</span>
      </div>
      <div className="h-3 w-full rounded-full bg-stone-800 overflow-hidden flex" role="progressbar" aria-valuenow={current} aria-valuemin={0} aria-valuemax={max}>
        <div className={`h-full ${HP_BAND_COLOR[band]} transition-all`} style={{ width: `${pct}%` }} />
        {tempPct > 0 && <div className="h-full bg-sky-500 transition-all" style={{ width: `${tempPct}%` }} />}
      </div>
    </div>
  );
}

// Exported for Token.tsx's map-overlay HP bar, which needs the same
// exact-numbers-to-band computation for its own (differently-shaped)
// indicator rather than a second hand-rolled copy of these thresholds.
export function bandFor(current: number, max: number): HpBand {
  if (current <= 0) return 'down';
  const pct = max > 0 ? current / max : 0;
  if (pct > 0.75) return 'healthy';
  if (pct > 0.5) return 'injured';
  if (pct > 0.25) return 'bloodied';
  return 'critical';
}

import type { HpBand } from '../lib/types';

const BAND_COLOR: Record<HpBand, string> = {
  Healthy: 'bg-emerald-600',
  Injured: 'bg-yellow-600',
  Bloodied: 'bg-orange-600',
  Critical: 'bg-red-600',
  Down: 'bg-stone-700',
};

const BAND_TEXT: Record<HpBand, string> = {
  Healthy: 'text-emerald-400',
  Injured: 'text-yellow-400',
  Bloodied: 'text-orange-400',
  Critical: 'text-red-400',
  Down: 'text-stone-400',
};

/** Exact-HP variant: current/max numeric bar with a temp-HP overlay segment. */
export function HPBar({ current, max, temp = 0 }: { current: number; max: number; temp?: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
  const tempPct = max > 0 ? Math.max(0, Math.min(100 - pct, (temp / max) * 100)) : 0;
  const band = bandFor(current, max);

  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between text-sm mb-1">
        <span className="font-semibold text-stone-100">
          {current} / {max}
          {temp > 0 && <span className="text-sky-400 font-normal"> (+{temp})</span>}
        </span>
        <span className={`text-xs font-medium ${BAND_TEXT[band]}`}>{band}</span>
      </div>
      <div className="h-3 w-full rounded-full bg-stone-800 overflow-hidden flex" role="progressbar" aria-valuenow={current} aria-valuemin={0} aria-valuemax={max}>
        <div className={`h-full ${BAND_COLOR[band]} transition-all`} style={{ width: `${pct}%` }} />
        {tempPct > 0 && <div className="h-full bg-sky-500 transition-all" style={{ width: `${tempPct}%` }} />}
      </div>
    </div>
  );
}

/** Banded-HP variant: a pill for player clients that never received exact numbers. */
export function HPBandPill({ band }: { band: HpBand }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium bg-stone-800 ${BAND_TEXT[band]}`}>
      <span className={`h-2 w-2 rounded-full ${BAND_COLOR[band]}`} />
      {band}
    </span>
  );
}

function bandFor(current: number, max: number): HpBand {
  if (current <= 0) return 'Down';
  const pct = max > 0 ? current / max : 0;
  if (pct > 0.75) return 'Healthy';
  if (pct > 0.5) return 'Injured';
  if (pct > 0.25) return 'Bloodied';
  return 'Critical';
}

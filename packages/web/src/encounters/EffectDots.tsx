// Shared active-effect indicator — previously only Token.tsx rendered this
// (a participant's conditions were invisible in PartyStatsSidebar.tsx, so
// the same participant looked identical there whether prone/grappled/etc.
// or not). One component now backs both, so the map and the sidebar always
// agree on how a participant's effects look.
import type { ActiveEffectSummary } from '../lib/types';

export function EffectDots({ effects, max = 4 }: { effects: ActiveEffectSummary[]; max?: number }) {
  if (effects.length === 0) return null;
  return (
    <div className="flex items-center gap-0.5">
      {effects.slice(0, max).map((e) => (
        <span key={e.effectId} title={e.name} aria-label={e.name} className="h-2 w-2 rounded-full bg-violet-500 ring-1 ring-stone-950" />
      ))}
      {effects.length > max && <span className="text-[8px] leading-none text-violet-300 self-center">+{effects.length - max}</span>}
    </div>
  );
}

// Eye-toggle for one revealable field (PLAN.md §2.1/§11.7). Deliberately a
// dumb presentational component — no data fetching of its own — so it can
// sit next to a field wherever that field is rendered (combat tracker row,
// character sheet, bestiary entry) without every caller needing to know
// about useReveals' query keys.

export function RevealToggle({
  revealed,
  onToggle,
  disabled = false,
  label,
}: {
  revealed: boolean;
  onToggle: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    // 40x40 hit target (REVISION-PLAN.md §9.2 — was 20x20, under this app's
    // own 40px minimum-target convention) wrapping a visually small glyph:
    // growing the *visible* circle to 40px would look bulky inline next to
    // text (this renders inline in dense rows — the combat tracker's AC
    // badge, the character sheet's "Reveal to players" list), so the
    // padding is invisible, not a bigger drawn control.
    // Colors are emerald/stone, not this app's amber/stone theme-swapped
    // palette — deliberately, same precedent as EffectBadge's violet:
    // "revealed" is a distinct semantic color, not the brand accent, so it
    // doesn't need to shift with the user's crimson/amber theme choice.
    // Contrast checked: emerald-400 text on emerald-950 background is
    // ~8.6:1, well clear of the 4.5:1 AA floor the rest of the palette was
    // audited against (index.css's top-of-file comment).
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      title={revealed ? `Hide ${label} from players` : `Reveal ${label} to players`}
      aria-label={revealed ? `Hide ${label} from players` : `Reveal ${label} to players`}
      aria-pressed={revealed}
      className="group inline-flex h-10 w-10 items-center justify-center disabled:opacity-40"
    >
      <span
        className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-xs leading-none transition-colors ${
          revealed
            ? 'border-emerald-700 bg-emerald-950/50 text-emerald-400 group-hover:bg-emerald-900/60'
            : 'border-stone-700 bg-stone-900 text-stone-600 group-hover:text-stone-400'
        }`}
      >
        {revealed ? '◉' : '○'}
      </span>
    </button>
  );
}

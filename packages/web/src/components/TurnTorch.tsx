// Signature element (REVISION-PLAN.md §10.3) — a small torch/flame glyph
// meant to "pass" from participant to participant as the current-turn
// indicator, reused consistently across the app (nav rail's active-campaign
// indicator, the Turns tab's active-encounter marker, etc.) rather than a
// different flourish per screen. This is just the icon, exported for that
// later wiring — matches the inline-SVG convention already used by
// PasswordInput.tsx's EyeIcon/EyeOffIcon (same viewBox/stroke-width style,
// `currentColor` so it inherits whatever text color class a parent applies,
// e.g. `text-amber-500`).
export function TurnTorch({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 2.25c1.5 2.25 3.75 3.75 3.75 6.75a3.75 3.75 0 1 1-7.5 0c0-.9.3-1.6.75-2.25-.9.6-1.5 1.65-1.5 3a4.5 4.5 0 1 0 9 0c0-3.75-2.55-5.4-4.5-7.5Z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15.75V21.75M9.75 21.75h4.5" />
    </svg>
  );
}

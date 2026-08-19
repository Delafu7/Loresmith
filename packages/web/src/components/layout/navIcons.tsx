// Sidebar nav icons (Arcane Console pass) — same inline-SVG convention as
// encounters/elements/icons.tsx (no icon package): viewBox="0 0 24 24",
// stroke="currentColor", strokeWidth={1.5}, {size, className} props.
// `currentColor` means each icon automatically follows NavItem's own
// active/hover text color — no separate active-state styling needed here.

type IconProps = { size?: number; className?: string };

export function DashboardIcon({ size = 18, className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} width={size} height={size} className={className} aria-hidden="true">
      <rect x="4" y="4" width="7" height="7" rx="1.2" />
      <rect x="13" y="4" width="7" height="7" rx="1.2" />
      <rect x="4" y="13" width="7" height="7" rx="1.2" />
      <rect x="13" y="13" width="7" height="7" rx="1.2" />
    </svg>
  );
}

export function CharactersIcon({ size = 18, className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} width={size} height={size} className={className} aria-hidden="true">
      <circle cx="12" cy="8.5" r="3.8" />
      <path strokeLinecap="round" d="M5 20c0-4.4 3.1-7.2 7-7.2s7 2.8 7 7.2" />
    </svg>
  );
}

export function MapIcon({ size = 18, className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} width={size} height={size} className={className} aria-hidden="true">
      <path strokeLinejoin="round" d="M3.5 6.2 9.5 4.4l5 1.8 5.5-1.8v15.6l-5.5 1.8-5-1.8-6 1.8Z" />
      <path d="M9.5 4.4v15.6M14.5 6.2v15.6" />
    </svg>
  );
}

export function BestiaryIcon({ size = 18, className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} width={size} height={size} className={className} aria-hidden="true">
      <path strokeLinejoin="round" d="M5 14.5c0-4.8 3-8.4 7-8.4s7 3.6 7 8.4-3 6-7 6-7-1.2-7-6Z" />
      <path strokeLinecap="round" d="M7.5 9.5 5.5 6.5M16.5 9.5l2-3" />
    </svg>
  );
}

export function CompendiumIcon({ size = 18, className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} width={size} height={size} className={className} aria-hidden="true">
      <path strokeLinejoin="round" d="M5 4.2h10.5a2.3 2.3 0 0 1 2.3 2.3V20H7a2.3 2.3 0 0 1-2.3-2.3Z" />
      <path strokeLinecap="round" d="M4.7 17.5a2.3 2.3 0 0 1 2.3-2.3h10.5" />
    </svg>
  );
}

export function SessionLogIcon({ size = 18, className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} width={size} height={size} className={className} aria-hidden="true">
      <path strokeLinecap="round" d="M5 6.5h14M5 12h14M5 17.5h8.5" />
    </svg>
  );
}

export function NotesIcon({ size = 18, className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} width={size} height={size} className={className} aria-hidden="true">
      <path strokeLinejoin="round" d="M6 4.2h8.5l3.5 3.5V19.8H6Z" />
      <path strokeLinejoin="round" d="M14.5 4.2v3.5H18" />
      <path strokeLinecap="round" d="M9 12h6M9 15.5h6" />
    </svg>
  );
}

export function CalendarIcon({ size = 18, className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} width={size} height={size} className={className} aria-hidden="true">
      <rect x="4.2" y="5.5" width="15.6" height="14.5" rx="1.8" />
      <path strokeLinecap="round" d="M4.2 10.2h15.6M8.5 3.5v3.6M15.5 3.5v3.6" />
    </svg>
  );
}

export function BastionsIcon({ size = 18, className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} width={size} height={size} className={className} aria-hidden="true">
      <path strokeLinejoin="round" d="M6.5 20.5V11.5 8.5h2.5V6h1v2.5h2.5V6h1v2.5h2.5V6h1v2.5h2.5v3 9" />
      <path strokeLinecap="round" d="M6.5 11.5h11" />
    </svg>
  );
}

export function DiceRollsIcon({ size = 18, className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} width={size} height={size} className={className} aria-hidden="true">
      <rect x="4.2" y="4.2" width="15.6" height="15.6" rx="3.6" transform="rotate(-8 12 12)" />
      <circle cx="9.5" cy="9.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="14.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function SettingsIcon({ size = 18, className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} width={size} height={size} className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="3.1" />
      <path
        strokeLinecap="round"
        d="M12 3.8v2.5M12 17.7v2.5M20.2 12h-2.5M6.3 12H3.8M18.1 5.9l-1.8 1.8M7.7 16.3l-1.8 1.8M18.1 18.1l-1.8-1.8M7.7 7.7 5.9 5.9"
      />
    </svg>
  );
}

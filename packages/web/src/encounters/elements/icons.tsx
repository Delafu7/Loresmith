// Palette/canvas icons for MapElement types — same inline-SVG convention as
// TurnTorch.tsx/PasswordInput.tsx (no icon package): viewBox="0 0 24 24",
// stroke="currentColor", strokeWidth={1.5}, {size, className} props.

type IconProps = { size?: number; className?: string };

export function WallIcon({ size = 20, className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} width={size} height={size} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M3 12h18M3 18h18M7.5 6v6M15 6v6M11.25 12v6M18.75 12v6" />
    </svg>
  );
}

export function DoorIcon({ size = 20, className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} width={size} height={size} className={className} aria-hidden="true">
      <rect x="6" y="3" width="12" height="18" rx="0.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="14.5" cy="12" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function LightIcon({ size = 20, className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} width={size} height={size} className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="4" strokeLinecap="round" strokeLinejoin="round" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 2.25v2.5M12 19.25v2.5M4.22 4.22l1.77 1.77M18 18l1.78 1.78M2.25 12h2.5M19.25 12h2.5M4.22 19.78l1.77-1.77M18 6l1.78-1.78"
      />
    </svg>
  );
}

export function AreaIcon({ size = 20, className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} width={size} height={size} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Z" />
    </svg>
  );
}

export function NoteIcon({ size = 20, className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} width={size} height={size} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 3.75h9L19.5 9v11.25a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.75a1 1 0 0 1 1-1Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 3.75V9h4.5M8.5 12.75h7M8.5 16h5" />
    </svg>
  );
}

export function ImageIcon({ size = 20, className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} width={size} height={size} className={className} aria-hidden="true">
      <rect x="3" y="4.5" width="18" height="15" rx="1" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="8.5" cy="10" r="1.25" strokeLinecap="round" strokeLinejoin="round" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m5.5 17 4.5-5 3.5 3.5 2-2.5 3 4" />
    </svg>
  );
}

// Generic image display primitive (PLAN.md §6.6's Portrait) — deliberately
// not character-specific: reused for character portraits now, and intended
// for creature art / map thumbnails later (BestiaryPage/BattleMap, later
// phases) without modification. No real thumbnail generation (that's a
// deliberate simplicity choice made in PLAN.md §3.5) — just CSS
// `object-fit: cover` at whatever display size is requested.

export type PortraitSize = 'sm' | 'md' | 'lg' | 'xl';
export type PortraitShape = 'square' | 'circle';

const SIZE_CLASSES: Record<PortraitSize, string> = {
  sm: 'h-10 w-10 text-sm',
  md: 'h-16 w-16 text-lg',
  lg: 'h-24 w-24 text-2xl',
  xl: 'h-36 w-36 text-4xl',
};

export function Portrait({
  fileUrl,
  alt,
  size = 'md',
  shape = 'square',
  placeholderLabel,
}: {
  /** Relative asset URL (e.g. `/uploads/campaigns/1/<uuid>.png`), or null/undefined for the placeholder. */
  fileUrl?: string | null;
  alt: string;
  size?: PortraitSize;
  shape?: PortraitShape;
  /** Text shown in the placeholder when there's no image — typically the first letter of a name. */
  placeholderLabel?: string;
}) {
  const shapeClass = shape === 'circle' ? 'rounded-full' : 'rounded-lg';
  const dimensionClass = SIZE_CLASSES[size];

  if (fileUrl) {
    return (
      <img
        src={fileUrl}
        alt={alt}
        className={`${dimensionClass} ${shapeClass} border border-stone-800 bg-stone-950 object-cover flex-shrink-0`}
      />
    );
  }

  const initial = placeholderLabel?.trim().charAt(0).toUpperCase();

  return (
    <div
      role="img"
      aria-label={alt}
      className={`${dimensionClass} ${shapeClass} border border-stone-800 bg-stone-800 text-stone-500 flex items-center justify-center font-semibold flex-shrink-0`}
    >
      {initial || (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-1/2 w-1/2">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM4.5 20a7.5 7.5 0 0 1 15 0"
          />
        </svg>
      )}
    </div>
  );
}

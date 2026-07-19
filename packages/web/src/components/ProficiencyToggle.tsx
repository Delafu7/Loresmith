// Tri-state toggle matching character_skill_proficiencies.level's actual DB
// enum ('proficient' | 'expertise') — "not proficient" is simply the absence
// of a row, not a third enum value, so the cycle is
// none -> proficient -> expertise -> none.

export type ProficiencyLevel = 'none' | 'proficient' | 'expertise';

const NEXT: Record<ProficiencyLevel, ProficiencyLevel> = {
  none: 'proficient',
  proficient: 'expertise',
  expertise: 'none',
};

const GLYPH: Record<ProficiencyLevel, string> = {
  none: '○', // ○
  proficient: '●', // ●
  expertise: '◉', // ◉
};

const LABEL: Record<ProficiencyLevel, string> = {
  none: 'Not proficient',
  proficient: 'Proficient',
  expertise: 'Expertise',
};

export function ProficiencyToggle({
  level,
  editable,
  onChange,
}: {
  level: ProficiencyLevel;
  editable: boolean;
  onChange?: (next: ProficiencyLevel) => void;
}) {
  if (!editable) {
    return (
      <span className="inline-block w-5 text-center text-amber-500" title={LABEL[level]} aria-label={LABEL[level]}>
        {GLYPH[level]}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onChange?.(NEXT[level])}
      title={`${LABEL[level]} (click to change)`}
      aria-label={LABEL[level]}
      className="inline-block w-6 h-6 text-center text-amber-500 hover:text-amber-400 hover:bg-stone-800 rounded transition-colors"
    >
      {GLYPH[level]}
    </button>
  );
}

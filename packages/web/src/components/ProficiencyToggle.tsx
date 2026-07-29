import { useLocale } from '../i18n/LocaleContext';

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

const LABEL_KEY = {
  none: 'proficiency.none',
  proficient: 'proficiency.proficient',
  expertise: 'proficiency.expertise',
} as const;

export function ProficiencyToggle({
  level,
  editable,
  onChange,
}: {
  level: ProficiencyLevel;
  editable: boolean;
  onChange?: (next: ProficiencyLevel) => void;
}) {
  const { t } = useLocale();
  const label = t(LABEL_KEY[level]);
  if (!editable) {
    return (
      <span className="inline-block w-5 text-center text-amber-500" title={label} aria-label={label}>
        {GLYPH[level]}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onChange?.(NEXT[level])}
      title={t('proficiency.clickToChange', { label })}
      aria-label={label}
      className="inline-block w-6 h-6 text-center text-amber-500 hover:text-amber-400 hover:bg-stone-800 rounded transition-colors"
    >
      {GLYPH[level]}
    </button>
  );
}

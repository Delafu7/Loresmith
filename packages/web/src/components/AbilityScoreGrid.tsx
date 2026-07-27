import { abilityModifier, formatModifier } from '../lib/dnd-math';

const ABILITIES: Array<{ key: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'; label: string }> = [
  { key: 'str', label: 'STR' },
  { key: 'dex', label: 'DEX' },
  { key: 'con', label: 'CON' },
  { key: 'int', label: 'INT' },
  { key: 'wis', label: 'WIS' },
  { key: 'cha', label: 'CHA' },
];

interface AbilityScores {
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
}

export function AbilityScoreGrid({
  scores,
  editable = false,
  onChange,
}: {
  scores: AbilityScores;
  editable?: boolean;
  onChange?: (key: keyof AbilityScores, value: number) => void;
}) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
      {ABILITIES.map(({ key, label }) => {
        const score = scores[key];
        const mod = abilityModifier(score);
        return (
          <div key={key} className="rounded-md bg-stone-900 shadow-sm p-3 text-center">
            <div className="text-xs font-semibold tracking-wide text-stone-500">{label}</div>
            {editable ? (
              <input
                type="number"
                min={1}
                max={30}
                value={score}
                onChange={(e) => onChange?.(key, Number(e.target.value))}
                aria-label={`${label} score`}
                className="w-full text-center bg-transparent text-2xl font-bold text-stone-100 my-1 focus:outline-none focus:ring-1 focus:ring-amber-500 rounded"
              />
            ) : (
              <div className="text-2xl font-bold text-stone-100 my-1">{score}</div>
            )}
            <div className="text-sm text-amber-500 font-medium">{formatModifier(mod)}</div>
          </div>
        );
      })}
    </div>
  );
}

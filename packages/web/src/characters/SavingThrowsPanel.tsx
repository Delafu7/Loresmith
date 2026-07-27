import type { AbilityScoreCatalog } from '../lib/types';
import { DiceRoller } from '../components/DiceRoller';
import { abilityModifier, formatModifier } from '../lib/dnd-math';

interface CharacterAbilities {
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
}

const KEY_ORDER: Array<keyof CharacterAbilities> = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export function abilityKeyFor(abilityScore: AbilityScoreCatalog): keyof CharacterAbilities | null {
  const key = abilityScore.index_key.toLowerCase();
  return (KEY_ORDER as string[]).includes(key) ? (key as keyof CharacterAbilities) : null;
}

export function SavingThrowsPanel({
  abilityScoresCatalog,
  abilities,
  proficientAbilityScoreIds,
  proficiencyBonus,
  editable,
  onToggle,
  characterId,
}: {
  abilityScoresCatalog: AbilityScoreCatalog[];
  abilities: CharacterAbilities;
  proficientAbilityScoreIds: Set<number>;
  proficiencyBonus: number;
  editable: boolean;
  onToggle: (abilityScoreId: number) => void;
  // Same reuse of `editable` as the roll-trigger gate as SkillsPanel — see
  // its comment for the reasoning.
  characterId: number;
}) {
  const ordered = [...abilityScoresCatalog].sort((a, b) => {
    const ai = KEY_ORDER.indexOf((abilityKeyFor(a) ?? 'str') as keyof CharacterAbilities);
    const bi = KEY_ORDER.indexOf((abilityKeyFor(b) ?? 'str') as keyof CharacterAbilities);
    return ai - bi;
  });

  return (
    <div className="rounded-md bg-stone-900 shadow-sm p-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500 mb-3">Saving throws</h3>
      <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {ordered.map((a) => {
          const key = abilityKeyFor(a);
          if (!key) return null;
          const isProficient = proficientAbilityScoreIds.has(a.id);
          const mod = abilityModifier(abilities[key]) + (isProficient ? proficiencyBonus : 0);
          return (
            <li key={a.id} className="flex items-center gap-2 text-sm">
              <button
                type="button"
                role="checkbox"
                aria-checked={isProficient}
                aria-label={`${a.name} save proficiency`}
                disabled={!editable}
                onClick={() => onToggle(a.id)}
                className={`h-4 w-4 rounded-full border flex-shrink-0 ${
                  isProficient ? 'bg-amber-500 border-amber-500' : 'bg-transparent border-stone-600'
                } ${editable ? 'cursor-pointer' : 'cursor-default'}`}
              />
              <span className="text-stone-300 flex-1">{a.name}</span>
              <span className="font-medium text-stone-100">{formatModifier(mod)}</span>
              {editable && (
                <DiceRoller
                  rollType="saving_throw"
                  rollContext={`${a.name} Save`}
                  modifier={mod}
                  characterId={characterId}
                  triggerLabel="⚄"
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

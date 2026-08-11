import type { AbilityScoreCatalog, SkillCatalog } from '../lib/types';
import type { ProficiencyLevel } from '../components/ProficiencyToggle';
import { ProficiencyToggle } from '../components/ProficiencyToggle';
import { DiceRoller } from '../components/DiceRoller';
import { skillModifier, formatModifier } from '../lib/dnd-math';
import { abilityKeyFor } from './SavingThrowsPanel';
import { useLocale } from '../i18n/LocaleContext';

interface CharacterAbilities {
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
}

export function SkillsPanel({
  skillsCatalog,
  abilityScoresCatalog,
  abilities,
  proficiencyBySkillId,
  proficiencyBonus,
  editable,
  canAct,
  onChange,
  characterId,
}: {
  skillsCatalog: SkillCatalog[];
  abilityScoresCatalog: AbilityScoreCatalog[];
  abilities: CharacterAbilities;
  proficiencyBySkillId: Map<string, ProficiencyLevel>;
  proficiencyBonus: number;
  editable: boolean;
  // CONTROL gate (useCharacterCanAct) — separate from `editable` (ownership).
  // Governs the roll trigger only; proficiency toggling stays on `editable`.
  // A player delegated control of a PC they don't own can now roll skill
  // checks even though they can't touch proficiency.
  canAct: boolean;
  onChange: (skillId: string, next: ProficiencyLevel) => void;
  characterId: string;
}) {
  const { t } = useLocale();
  // Known gap (dnd-srd-rules-validator, Phase 3.4): Bard's Jack of All Trades
  // (add half proficiency bonus, rounded down, to non-proficient checks) isn't
  // modeled — the tri-state proficiency toggle has no "half" state, so a
  // Bard's non-proficient skill rolls here are mechanically understated by
  // floor(proficiencyBonus/2). Not fixed in this phase; flagged so it isn't
  // mistaken for a deliberately-correct simplification like the InventoryPanel
  // weapon-proficiency assumption below.
  const abilityById = new Map(abilityScoresCatalog.map((a) => [a.id, a]));
  const sorted = [...skillsCatalog].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="rounded-md bg-stone-900 shadow-sm p-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500 mb-3">{t('characters.skills.title')}</h3>
      <ul className="space-y-1">
        {sorted.map((skill) => {
          const ability = abilityById.get(skill.ability_score_id);
          const abilityKey = ability ? abilityKeyFor(ability) : null;
          const level = proficiencyBySkillId.get(skill.id) ?? 'none';
          const mod = abilityKey ? skillModifier(abilities[abilityKey], proficiencyBonus, level) : 0;
          return (
            <li key={skill.id} className="flex items-center gap-2 text-sm py-0.5">
              <ProficiencyToggle level={level} editable={editable} onChange={(next) => onChange(skill.id, next)} />
              <span className="text-stone-300 flex-1">{skill.name}</span>
              {ability && <span className="text-xs text-stone-600 uppercase w-8">{ability.index_key}</span>}
              <span className="font-medium text-stone-100 w-8 text-right">{formatModifier(mod)}</span>
              {canAct && (
                <DiceRoller
                  rollType="skill_check"
                  rollContext={skill.name}
                  modifier={mod}
                  characterId={characterId}
                  triggerLabel="⚄"
                  allowHiddenRoll
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

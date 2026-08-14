import { useEffect, useRef } from 'react';
import type { WizardDraft, SkillProficiencyLevel } from './types';
import type { AbilityKey } from '../abilityScoreGeneration';
import type { ClassCatalog } from '../../lib/types';
import { useSkillsCatalog, useAbilityScoresCatalog } from '../../lib/useCatalog';
import { formatModifier, proficiencyBonusForLevel, skillModifier } from '../../lib/dnd-math';
import { Loading } from '../../components/Feedback';
import { useLocale } from '../../i18n/LocaleContext';

const LEVEL_CYCLE: (SkillProficiencyLevel | 'none')[] = ['none', 'proficient', 'expertise'];

export function SkillsStep({
  draft,
  onChange,
  selectedClass,
  readOnly,
}: {
  draft: WizardDraft;
  onChange: (patch: Partial<WizardDraft>) => void;
  selectedClass: ClassCatalog | null;
  readOnly: boolean;
}) {
  const { t } = useLocale();
  const skillsQuery = useSkillsCatalog();
  const abilityScoresQuery = useAbilityScoresCatalog();

  // Subclasses carry zero mechanical data columns today (compendium feature
  // decision — substitute class-level effects instead), so "selecting a
  // subclass applies mechanical effects" is satisfied by auto-populating
  // saving-throw proficiencies from the selected CLASS's own
  // saving_throw_proficiency_ids. Applied once per distinct class selection,
  // and only while the list is still untouched, so it prefills a sensible
  // default without fighting a save the player already customized.
  const appliedClassId = useRef<string | null>(null);
  useEffect(() => {
    if (readOnly || !selectedClass || appliedClassId.current === selectedClass.id) return;
    appliedClassId.current = selectedClass.id;
    if (draft.savingThrowAbilityScoreIds.length === 0 && selectedClass.saving_throw_proficiency_ids) {
      onChange({ savingThrowAbilityScoreIds: selectedClass.saving_throw_proficiency_ids });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClass?.id, readOnly]);

  if (skillsQuery.isLoading || abilityScoresQuery.isLoading) return <Loading />;

  const abilityById = new Map((abilityScoresQuery.data?.abilityScores ?? []).map((a) => [a.id, a]));
  const proficiencyBonus = proficiencyBonusForLevel(draft.level);

  function cycleSkill(skillId: string) {
    if (readOnly) return;
    const current = draft.skillLevels[skillId] ?? 'none';
    const next = LEVEL_CYCLE[(LEVEL_CYCLE.indexOf(current) + 1) % LEVEL_CYCLE.length]!;
    const nextLevels = { ...draft.skillLevels };
    if (next === 'none') delete nextLevels[skillId];
    else nextLevels[skillId] = next;
    onChange({ skillLevels: nextLevels });
  }

  function toggleSave(abilityScoreId: string) {
    if (readOnly) return;
    const has = draft.savingThrowAbilityScoreIds.includes(abilityScoreId);
    onChange({
      savingThrowAbilityScoreIds: has
        ? draft.savingThrowAbilityScoreIds.filter((id) => id !== abilityScoreId)
        : [...draft.savingThrowAbilityScoreIds, abilityScoreId],
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-xs uppercase text-stone-500 mb-2">{t('characters.wizard.skills.savingThrows')}</h4>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {(abilityScoresQuery.data?.abilityScores ?? []).map((a) => {
            const checked = draft.savingThrowAbilityScoreIds.includes(a.id);
            return (
              <label
                key={a.id}
                className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs uppercase ${
                  checked ? 'bg-amber-950/30 text-amber-400 outline outline-1 outline-amber-600' : 'bg-stone-800 text-stone-400'
                }`}
              >
                <input type="checkbox" checked={checked} disabled={readOnly} onChange={() => toggleSave(a.id)} className="accent-amber-500" />
                {a.index_key}
              </label>
            );
          })}
        </div>
      </div>

      <div>
        <h4 className="text-xs uppercase text-stone-500 mb-2">{t('characters.wizard.skills.skillsHeading')}</h4>
        <ul className="divide-y divide-stone-800 rounded-md bg-stone-900">
          {(skillsQuery.data?.skills ?? []).map((skill) => {
            const ability = abilityById.get(skill.ability_score_id);
            const abilityKey = (ability?.index_key ?? 'str') as AbilityKey;
            const level = draft.skillLevels[skill.id] ?? 'none';
            const mod = skillModifier(draft.scores[abilityKey] ?? 10, proficiencyBonus, level);
            return (
              <li key={skill.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="text-stone-200">
                  {skill.name} <span className="text-stone-500 text-xs uppercase">({abilityKey})</span>
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-stone-400 text-xs w-8 text-right">{formatModifier(mod)}</span>
                  <button
                    type="button"
                    disabled={readOnly}
                    onClick={() => cycleSkill(skill.id)}
                    className={`min-h-9 rounded-md px-2.5 text-xs ${
                      level === 'expertise'
                        ? 'bg-amber-950/30 text-amber-400 outline outline-1 outline-amber-600'
                        : level === 'proficient'
                          ? 'bg-sky-950/30 text-sky-400 outline outline-1 outline-sky-600'
                          : 'bg-stone-800 text-stone-500'
                    }`}
                  >
                    {level === 'expertise'
                      ? t('characters.wizard.skills.expertise')
                      : level === 'proficient'
                        ? t('characters.wizard.skills.proficient')
                        : t('characters.wizard.skills.none')}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
